/**
 * @fileoverview Background automation loop for kanban tasks claimed by the external runner.
 *
 * Exports:
 * - KANBAN_RUNNER_AGENT_ID - Stable agent identity used for automatic task claiming.
 * - KanbanRunnerService - Polls unfinished work, starts fresh OpenCode sessions, and resumes tasks.
 */

import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { EventsService } from "../events/events.service";
import { OpenCodeClient } from "../open-code/opencode-client";
import { OpenCodeEventsService } from "../open-code/opencode-events.service";
import { ProjectsService } from "../projects/projects.service";
import { buildKanbanRunnerPrompt } from "./kanban-runner-prompt";
import { KanbanRunnerSessionService } from "./kanban-runner-session.service";
import { KanbanService } from "./kanban.service";
import { KanbanTaskView } from "./kanban.types";

const MIN_RUNNER_CLAIM_LEASE_MS = 30 * 60 * 1000;
const RUNNER_EVENT_CONNECT_TIMEOUT_MS = 60_000;

export const KANBAN_RUNNER_AGENT_ID = "kanban-runner";

@Injectable()
export class KanbanRunnerService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private readonly runningProjects = new Set<string>();

  public constructor(
    @Inject(ConfigToken) private readonly config: AppConfig,
    private readonly kanban: KanbanService,
    private readonly runnerSessions: KanbanRunnerSessionService,
    private readonly projects: ProjectsService,
    private readonly opencode: OpenCodeClient,
    private readonly opencodeEvents: OpenCodeEventsService,
    private readonly events: EventsService
  ) {}

  public onModuleInit(): void {
    /* Keep the automation loop fully opt-in so environments without approval can stay passive. */
    if (!this.config.kanbanRunnerEnabled) {
      return;
    }

    void this.runOnce("startup");
    this.timer = setInterval(() => {
      void this.runOnce("interval");
    }, this.config.kanbanRunnerIntervalMs);
    this.timer.unref?.();
  }

  public onModuleDestroy(): void {
    /* Stop periodic wake-ups cleanly during shutdown and tests. */
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  public async runOnce(reason: "startup" | "interval"): Promise<void> {
    /* One scheduler pass may resume multiple projects, but never overlaps the same project twice. */
    if (!this.config.kanbanRunnerEnabled) {
      return;
    }

    const tasks = await this.kanban.listTasks();
    const candidateProjects = [...new Set(tasks.filter((task) => this.isAutomationCandidate(task)).map((task) => task.projectSlug))].filter(
      (projectSlug) => !this.runningProjects.has(projectSlug)
    );

    await Promise.all(candidateProjects.map((projectSlug) => this.runProject({ projectSlug, reason })));
  }

  private isAutomationCandidate(task: KanbanTaskView): boolean {
    /* The runner cares only about queued work and its own unfinished active task. */
    if (task.status === "queued") {
      return true;
    }
    return task.status === "in_progress" && task.claimedBy === KANBAN_RUNNER_AGENT_ID;
  }

  private async runProject(input: {
    projectSlug: string;
    reason: "startup" | "interval";
  }): Promise<void> {
    /* Each project keeps its own serialized loop so fresh-session automation remains deterministic. */
    this.runningProjects.add(input.projectSlug);
    let task: KanbanTaskView | null = null;

    try {
      task = await this.resolveTaskForRun(input.projectSlug);
      if (!task) {
        return;
      }

      const directory = this.projects.getProjectRootPath(input.projectSlug);
      this.opencodeEvents.ensureDirectory(directory);
      await this.waitForEventBridge(directory);

      /* Keep the same session for the same task; only rotate when a different queued task gets claimed. */
      const taskId = task.id;
      const sessionId = await this.ensureTaskSession({ taskId: task.id, directory });
      const prompt = buildKanbanRunnerPrompt(task);

      this.events.publish({
        type: "kanban.runner.started",
        ts: new Date().toISOString(),
        data: {
          reason: input.reason,
          projectSlug: input.projectSlug,
          taskId,
          taskTitle: task.title,
          sessionId
        }
      });

      const promptResult = await this.opencode.sendPromptToSession(prompt, {
        directory,
        sessionID: sessionId
      });
      const refreshedTask = await this.loadTask(taskId, input.projectSlug);

      this.events.publish({
        type: "kanban.runner.finished",
        ts: new Date().toISOString(),
        data: {
          reason: input.reason,
          projectSlug: input.projectSlug,
          taskId,
          taskTitle: refreshedTask?.title ?? task.title,
          sessionId: promptResult.sessionId,
          status: refreshedTask?.status ?? null
        }
      });

      if (refreshedTask?.status === "blocked" && refreshedTask.blockedReason) {
        this.events.publish({
          type: "kanban.runner.blocked",
          ts: new Date().toISOString(),
          data: {
            projectSlug: input.projectSlug,
            taskId,
            taskTitle: refreshedTask.title,
            blockedReason: refreshedTask.blockedReason
          }
        });
      }
    } catch (error) {
      this.events.publish({
        type: "kanban.runner.error",
        ts: new Date().toISOString(),
        data: {
          reason: input.reason,
          projectSlug: input.projectSlug,
          taskId: task?.id ?? null,
          taskTitle: task?.title ?? null,
          message: error instanceof Error ? error.message : "Kanban runner failed"
        }
      });
    } finally {
      this.runningProjects.delete(input.projectSlug);
    }
  }

  private async resolveTaskForRun(projectSlug: string): Promise<KanbanTaskView | null> {
    /* Resume unfinished runner-owned work first, otherwise claim the next queued task for automation. */
    const tasks = await this.kanban.listTasks({ projectSlug });
    const activeTask = tasks.find(
      (task) => task.status === "in_progress" && task.claimedBy === KANBAN_RUNNER_AGENT_ID
    );
    if (activeTask) {
      return activeTask;
    }

    const hasQueued = tasks.some((task) => task.status === "queued");
    if (!hasQueued) {
      return null;
    }

    return this.kanban.claimNextTask({
      projectSlug,
      agentId: KANBAN_RUNNER_AGENT_ID,
      leaseMs: Math.max(this.config.kanbanRunnerIntervalMs, MIN_RUNNER_CLAIM_LEASE_MS)
    });
  }

  private async ensureTaskSession(input: { taskId: string; directory: string }): Promise<string> {
    /* Reuse stored task sessions whenever possible so unfinished work keeps its accumulated context. */
    const existingSessionId = await this.runnerSessions.getTaskSessionId(input.taskId);
    if (existingSessionId) {
      return existingSessionId;
    }

    const created = await this.opencode.createDetachedSession({ directory: input.directory });
    await this.runnerSessions.setTaskSessionId(input.taskId, created.id);
    return created.id;
  }

  private async loadTask(taskId: string, projectSlug: string): Promise<KanbanTaskView | null> {
    /* Refresh persisted task state after each run so notifications reflect the actual terminal status. */
    const tasks = await this.kanban.listTasks({ projectSlug });
    return tasks.find((task) => task.id === taskId) ?? null;
  }

  private async waitForEventBridge(directory: string): Promise<void> {
    /* Runner sessions should fail fast if the SSE bridge never comes online instead of hanging forever. */
    let timeout: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        this.opencodeEvents.waitUntilConnected(directory),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new Error(`Timed out waiting for OpenCode events in ${directory}`));
          }, RUNNER_EVENT_CONNECT_TIMEOUT_MS);
          timeout.unref?.();
        })
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
