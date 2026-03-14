/**
 * @fileoverview Event-driven automation loop for kanban tasks claimed by the external runner.
 *
 * Exports:
 * - KANBAN_RUNNER_AGENT_ID - Stable agent identity used for automatic task claiming.
 * - KanbanRunnerService - Reacts to kanban/session events, starts OpenCode sessions, and resumes tasks.
 */

import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { EventEnvelope } from "../events/events.types";
import { EventsService } from "../events/events.service";
import { OpenCodeClient } from "../open-code/opencode-client";
import { OpenCodeEventsService } from "../open-code/opencode-events.service";
import { extractFinalOpenCodeText } from "../open-code/opencode-text-parts";
import { ProjectsService } from "../projects/projects.service";
import { buildKanbanRunnerPrompt } from "./kanban-runner-prompt";
import { KanbanRunnerSessionService } from "./kanban-runner-session.service";
import { KanbanService } from "./kanban.service";
import { KanbanTaskView } from "./kanban.types";

const MIN_RUNNER_CLAIM_LEASE_MS = 30 * 60 * 1000;
const RUNNER_EVENT_CONNECT_TIMEOUT_MS = 60_000;

type KanbanRunnerReason = "startup" | "task-event" | "runner-finished";

export const KANBAN_RUNNER_AGENT_ID = "kanban-runner";

@Injectable()
export class KanbanRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly runningProjects = new Set<string>();
  private readonly pendingProjects = new Set<string>();
  private unsubscribe?: () => void;

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
    /* Keep automation fully opt-in and wire one event subscription for the process lifetime. */
    if (!this.config.kanbanRunnerEnabled) {
      return;
    }

    this.unsubscribe = this.events.subscribe((event) => this.onEvent(event));
    void this.runOnce("startup");
  }

  public onModuleDestroy(): void {
    /* Remove event subscription cleanly during shutdown and tests. */
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  public async runOnce(reason: KanbanRunnerReason): Promise<void> {
    /* One event-driven pass may resume multiple projects, but never overlaps the same project twice. */
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
    reason: KanbanRunnerReason;
  }): Promise<void> {
    /* Each project keeps its own serialized loop so event bursts cannot start duplicate OpenCode turns. */
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
          status: refreshedTask?.status ?? null,
          claimedBy: refreshedTask?.claimedBy ?? null,
          finalText: extractFinalOpenCodeText(promptResult.parts) || promptResult.responseText
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

      /* Re-run once after the current turn ends when a completion/task event arrived mid-flight. */
      if (this.pendingProjects.delete(input.projectSlug)) {
        void this.runProject({ projectSlug: input.projectSlug, reason: "runner-finished" });
      }
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
      leaseMs: MIN_RUNNER_CLAIM_LEASE_MS
    });
  }

  private onEvent(event: EventEnvelope): void {
    /* Runner reacts only to events that can create or advance automation work. */
    if (!this.config.kanbanRunnerEnabled) {
      return;
    }

    if (event.type === "kanban.task.updated") {
      const projectSlug = String((event.data as any)?.projectSlug ?? "").trim();
      const status = String((event.data as any)?.status ?? "").trim();
      const claimedBy = String((event.data as any)?.claimedBy ?? "").trim();
      if (!projectSlug) {
        return;
      }

      const isCandidate = status === "queued" || (status === "in_progress" && claimedBy === KANBAN_RUNNER_AGENT_ID);
      if (isCandidate) {
        this.scheduleProjectRun(projectSlug, "task-event");
      }
      return;
    }

    if (event.type !== "kanban.runner.finished") {
      return;
    }

    const projectSlug = String((event.data as any)?.projectSlug ?? "").trim();
    const status = String((event.data as any)?.status ?? "").trim();
    const claimedBy = String((event.data as any)?.claimedBy ?? "").trim();
    if (!projectSlug) {
      return;
    }

    /* Continue only unfinished runner-owned work; done/blocked turns stop naturally. */
    if (status === "in_progress" && claimedBy === KANBAN_RUNNER_AGENT_ID) {
      this.scheduleProjectRun(projectSlug, "runner-finished");
    }
  }

  private scheduleProjectRun(projectSlug: string, reason: KanbanRunnerReason): void {
    /* Collapse bursts of task/runtime events into one serialized follow-up run per project. */
    if (this.runningProjects.has(projectSlug)) {
      this.pendingProjects.add(projectSlug);
      return;
    }

    void this.runProject({ projectSlug, reason });
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
