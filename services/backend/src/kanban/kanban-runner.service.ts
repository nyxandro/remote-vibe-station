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
import { isOpenCodeFetchTransportFailure, normalizeOpenCodeTransportErrorMessage } from "../open-code/opencode-transport-errors";
import { OpenCodePart } from "../open-code/opencode.types";
import { ProjectsService } from "../projects/projects.service";
import { buildKanbanRunnerPrompt } from "./kanban-runner-prompt";
import { KanbanRunnerSessionService } from "./kanban-runner-session.service";
import { KanbanExecutionConflictError } from "./kanban.errors";
import { KanbanService } from "./kanban.service";
import { KanbanTaskView } from "./kanban.types";

const MIN_RUNNER_CLAIM_LEASE_MS = 30 * 60 * 1000;
const RUNNER_EVENT_CONNECT_TIMEOUT_MS = 60_000;
const RUNNER_FETCH_SETTLE_TIMEOUT_MS = 30_000;

type KanbanRunnerReason = "startup" | "task-event" | "runner-finished";
type KanbanRunnerAction = "started" | "continued";
type KanbanRunnerSession = {
  sessionId: string;
  startedNewSession: boolean;
};

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
      return task.executionSource !== "session";
    }
    return (
      task.status === "in_progress" &&
      task.claimedBy === KANBAN_RUNNER_AGENT_ID &&
      task.executionSource === "runner"
    );
  }

  private async runProject(input: {
    projectSlug: string;
    reason: KanbanRunnerReason;
  }): Promise<void> {
    /* Each project keeps its own serialized loop so event bursts cannot start duplicate OpenCode turns. */
    this.runningProjects.add(input.projectSlug);
    let task: KanbanTaskView | null = null;

    try {
      const selection = await this.resolveTaskForRun(input.projectSlug);
      if (!selection) {
        return;
      }
      task = selection.task;

      const directory = this.projects.getProjectRootPath(input.projectSlug);
      this.opencodeEvents.ensureDirectory(directory);
      await this.waitForEventBridge(directory);

      /* Keep the same session for the same task; queued work is claimed only after its dedicated session exists. */
      const taskId = task.id;
      const taskSession = await this.ensureTaskSession({
        taskId: task.id,
        directory,
        preferredSessionId: task.executionSessionId ?? null
      });
      const sessionId = taskSession.sessionId;
      if (selection.action === "started") {
        try {
          task = await this.kanban.startTaskExecution({
            taskId,
            agentId: KANBAN_RUNNER_AGENT_ID,
            executionSource: "runner",
            executionSessionId: sessionId,
            leaseMs: MIN_RUNNER_CLAIM_LEASE_MS
          });
        } catch (error) {
          /* A human/session may legitimately win the race to start queued work; that is not a runner failure. */
          if (error instanceof KanbanExecutionConflictError) {
            return;
          }
          throw error;
        }
      }

      /* Fresh runner sessions should become Telegram-visible immediately so follow-up messages land in the same thread. */
      if (taskSession.startedNewSession) {
        this.opencode.rememberSelectedSession({ directory, sessionID: sessionId });
      }

      const prompt = buildKanbanRunnerPrompt(task);

      this.events.publish({
        type: "kanban.runner.started",
        ts: new Date().toISOString(),
        data: {
          action: selection.action,
          reason: input.reason,
          projectSlug: input.projectSlug,
          taskId,
          taskTitle: task.title,
          sessionId,
          startedNewSession: taskSession.startedNewSession
        }
      });

      const promptResult = await this.sendPromptWithSettle({ directory, sessionId, prompt });
      const refreshedTask = await this.loadTask(taskId, input.projectSlug);

      this.events.publish({
        type: "kanban.runner.finished",
        ts: new Date().toISOString(),
        data: {
          action: selection.action,
          reason: input.reason,
          projectSlug: input.projectSlug,
          taskId,
          taskTitle: refreshedTask?.title ?? task.title,
          sessionId: promptResult.sessionId,
          startedNewSession: taskSession.startedNewSession,
          status: refreshedTask?.status ?? null,
          claimedBy: refreshedTask?.claimedBy ?? null,
          executionSource: refreshedTask?.executionSource ?? null,
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
          message: normalizeOpenCodeTransportErrorMessage(error)
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

  private async resolveTaskForRun(projectSlug: string): Promise<{ task: KanbanTaskView; action: KanbanRunnerAction } | null> {
    /* Resume unfinished runner-owned work first and never start another queued task while any project task is already active. */
    const tasks = await this.kanban.listTasks({ projectSlug });
    const activeTask = tasks.find(
      (task) =>
        task.status === "in_progress" &&
        task.claimedBy === KANBAN_RUNNER_AGENT_ID &&
        task.executionSource === "runner"
    );
    if (activeTask) {
      return { task: activeTask, action: "continued" };
    }

    const hasAnyActiveTask = tasks.some((task) => task.status === "in_progress");
    if (hasAnyActiveTask) {
      return null;
    }

    const queuedTask = tasks.find((task) => task.status === "queued" && task.executionSource !== "session") ?? null;
    if (!queuedTask) {
      return null;
    }

    return { task: queuedTask, action: "started" };
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
      const executionSource = String((event.data as any)?.executionSource ?? "").trim();
      const source = String((event.data as any)?.source ?? "").trim();
      if (!projectSlug) {
        return;
      }

      const isCandidate =
        (status === "queued" && executionSource !== "session" && source !== "agent") ||
        (status === "in_progress" && claimedBy === KANBAN_RUNNER_AGENT_ID && executionSource === "runner") ||
        status === "blocked" ||
        status === "done";
      if (isCandidate) {
        this.scheduleProjectRun(projectSlug, "task-event");
      }
      return;
    }

    if (event.type === "opencode.message") {
      const projectSlug = String((event.data as any)?.projectSlug ?? "").trim();
      if (projectSlug) {
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
    const executionSource = String((event.data as any)?.executionSource ?? "").trim();
    if (!projectSlug) {
      return;
    }

    /* Continue only unfinished runner-owned work; done/blocked turns stop naturally. */
    if (status === "in_progress" && claimedBy === KANBAN_RUNNER_AGENT_ID && executionSource === "runner") {
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

  private async ensureTaskSession(input: {
    taskId: string;
    directory: string;
    preferredSessionId?: string | null;
  }): Promise<KanbanRunnerSession> {
    /* Reuse stored task sessions whenever possible so unfinished work keeps its accumulated context. */
    const preferredSessionId = input.preferredSessionId?.trim();
    if (preferredSessionId) {
      return {
        sessionId: preferredSessionId,
        startedNewSession: false
      };
    }

    const existingSessionId = await this.runnerSessions.getTaskSessionId(input.taskId);
    if (existingSessionId) {
      return {
        sessionId: existingSessionId,
        startedNewSession: false
      };
    }

    const created = await this.opencode.createDetachedSession({ directory: input.directory });
    await this.runnerSessions.setTaskSessionId(input.taskId, created.id);
    return {
      sessionId: created.id,
      startedNewSession: true
    };
  }

  private async sendPromptWithSettle(input: {
    directory: string;
    sessionId: string;
    prompt: string;
  }): Promise<{ sessionId: string; responseText: string; parts: OpenCodePart[] }> {
    /* Detached runner turns may finish successfully even if the synchronous HTTP request drops after handing work to OpenCode. */
    try {
      const result = await this.opencode.sendPromptToSession(input.prompt, {
        directory: input.directory,
        sessionID: input.sessionId
      });
      return {
        sessionId: result.sessionId,
        responseText: result.responseText,
        parts: (result.parts ?? []) as OpenCodePart[]
      };
    } catch (error) {
      if (!isOpenCodeFetchTransportFailure(error)) {
        throw error;
      }

      const settled = await this.opencode.waitForSessionToSettle({
        directory: input.directory,
        sessionID: input.sessionId,
        timeoutMs: RUNNER_FETCH_SETTLE_TIMEOUT_MS
      });
      if (!settled) {
        throw error;
      }

      return {
        sessionId: input.sessionId,
        responseText: "",
        parts: []
      };
    }
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
