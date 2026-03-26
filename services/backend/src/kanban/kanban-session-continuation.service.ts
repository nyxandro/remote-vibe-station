/**
 * @fileoverview Delivery-backed orchestration loop for session-owned kanban tasks.
 *
 * Exports:
 * - KanbanSessionContinuationService - Waits for final Telegram delivery, then either continues the same task or hands off to the next queued one.
 */

import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { EventEnvelope } from "../events/events.types";
import { EventsService } from "../events/events.service";
import { OpenCodeClient } from "../open-code/opencode-client";
import { OpenCodeEventsService } from "../open-code/opencode-events.service";
import { OpenCodeSessionRoutingStore } from "../open-code/opencode-session-routing.store";
import { ProjectsService } from "../projects/projects.service";
import { TelegramOutboxStore } from "../telegram/outbox/telegram-outbox.store";
import { TelegramPromptQueueService } from "../telegram/prompt-queue/telegram-prompt-queue.service";
import { publishKanbanTaskUpdated } from "./kanban-task-events";
import { buildKanbanRunnerPrompt } from "./kanban-runner-prompt";
import { buildKanbanSessionContinuationPrompt } from "./kanban-session-continuation-prompt";
import { KanbanSessionContinuationEntry, KanbanSessionContinuationStore } from "./kanban-session-continuation.store";
import { KanbanService } from "./kanban.service";
import { KanbanTaskView } from "./kanban.types";

const DEFAULT_SESSION_AGENT_ID = "opencode-agent";

@Injectable()
export class KanbanSessionContinuationService implements OnModuleInit, OnModuleDestroy {
  private unsubscribe?: () => void;

  public constructor(
    private readonly events: EventsService,
    private readonly store: KanbanSessionContinuationStore,
    private readonly outbox: TelegramOutboxStore,
    private readonly kanban: KanbanService,
    private readonly projects: ProjectsService,
    private readonly opencode: OpenCodeClient,
    private readonly sessionRouting: OpenCodeSessionRoutingStore,
    private readonly opencodeEvents: OpenCodeEventsService,
    private readonly promptQueue: TelegramPromptQueueService
  ) {}

  public onModuleInit(): void {
    /* Subscribe once and reconcile persisted continuation barriers against current outbox delivery state. */
    this.unsubscribe = this.events.subscribe((event) => this.onEvent(event));
    void this.reconcilePersistedBarriers().catch((error) => {
      this.publishContinuationError({
        adminId: null,
        projectSlug: "",
        taskId: null,
        sessionId: "",
        error
      });
    });
  }

  public onModuleDestroy(): void {
    /* Tests and process shutdown should detach the event listener cleanly. */
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private onEvent(event: EventEnvelope): void {
    if (event.type === "opencode.session.stopped") {
      this.suppressSessionContinuation(event);
      return;
    }

    if (event.type === "opencode.turn.started") {
      this.releaseSuppressedSession(event);
      return;
    }

    if (event.type === "telegram.assistant.reply.enqueued") {
      void this.capturePendingContinuation(event).catch((error) => {
        this.publishContinuationError({
          adminId: Number((event.data as any)?.adminId),
          projectSlug: String((event.data as any)?.projectSlug ?? "").trim(),
          taskId: null,
          sessionId: String((event.data as any)?.sessionId ?? "").trim(),
          error
        });
      });
      return;
    }

    if (event.type === "telegram.outbox.delivered") {
      this.releaseDeliveredBarrier(event);
    }
  }

  private async capturePendingContinuation(event: EventEnvelope): Promise<void> {
    /* Final assistant replies from a session-owned kanban turn unlock either same-session continuation or next-task handoff. */
    const adminId = Number((event.data as any)?.adminId);
    const projectSlug = String((event.data as any)?.projectSlug ?? "").trim();
    const sessionId = String((event.data as any)?.sessionId ?? "").trim();
    const deliveryGroupId = String((event.data as any)?.deliveryGroupId ?? "").trim();
    const pendingItemIds = Array.isArray((event.data as any)?.itemIds)
      ? (event.data as any).itemIds
          .map((item: unknown) => (typeof item === "string" ? item.trim() : ""))
          .filter((item: string) => item.length > 0)
      : [];
    if (!Number.isFinite(adminId) || !projectSlug || !sessionId || !deliveryGroupId || pendingItemIds.length === 0) {
      return;
    }
    if (this.store.isSessionSuppressed(sessionId)) {
      this.store.deleteSession(sessionId);
      return;
    }

    const task = await this.resolveSessionOwnedTask({ projectSlug, sessionId });
    if (!task) {
      this.store.deleteSession(sessionId);
      return;
    }

    this.store.save({
      adminId,
      projectSlug,
      taskId: task.id,
      sessionId,
      deliveryGroupId,
      pendingItemIds,
      createdAt: new Date().toISOString()
    });

    /* Waiting breadcrumb makes the delivery-backed continuation visible in the event log before the next turn starts. */
    this.events.publish({
      type: "kanban.session.continuation.waiting",
      ts: new Date().toISOString(),
      data: {
        adminId,
        projectSlug,
        taskId: task.id,
        sessionId,
        deliveryGroupId,
        pendingItemIds
      }
    });
  }

  private releaseDeliveredBarrier(event: EventEnvelope): void {
    /* Delivery confirmations advance continuation barriers chunk-by-chunk until the whole final reply lands. */
    const deliveryGroupId = String((event.data as any)?.deliveryGroupId ?? "").trim();
    const itemId = String((event.data as any)?.itemId ?? "").trim();
    if (!deliveryGroupId || !itemId) {
      return;
    }

    const released = this.store.markDelivered({ deliveryGroupId, itemId });
    if (!released) {
      return;
    }

    void this.triggerContinuation(released);
  }

  private async triggerContinuation(entry: KanbanSessionContinuationEntry): Promise<void> {
    /* Re-check persisted task state after delivery because a human may have already changed the workflow meanwhile. */
    try {
      if (this.store.isSessionSuppressed(entry.sessionId)) {
        return;
      }

      const task = await this.resolveSessionOwnedTask({
        projectSlug: entry.projectSlug,
        sessionId: entry.sessionId,
        taskId: entry.taskId
      });
      if (!task) {
        return;
      }

      if (task.status === "done") {
        await this.startNextQueuedTask(entry, task);
        return;
      }

      if (task.status !== "in_progress") {
        return;
      }

      const directory = this.projects.getProjectRootPath(entry.projectSlug);
      await this.opencode.selectSession({ directory, sessionID: entry.sessionId });

      /* Rebind routing so the resumed turn stays anchored to the same Telegram admin and permission callbacks. */
      this.sessionRouting.bind(entry.sessionId, { adminId: entry.adminId, directory });
      this.opencodeEvents.watchPermissionOnce({ directory, sessionID: entry.sessionId });

      await this.promptQueue.enqueueSystemPrompt({
        adminId: entry.adminId,
        projectSlug: entry.projectSlug,
        directory,
        text: buildKanbanSessionContinuationPrompt(task)
      });

      this.events.publish({
        type: "kanban.session.continuation.triggered",
        ts: new Date().toISOString(),
        data: {
          adminId: entry.adminId,
          projectSlug: entry.projectSlug,
          taskId: entry.taskId,
          sessionId: entry.sessionId
        }
      });
    } catch (error) {
      /* Continuation failures must surface explicitly so operators know why same-session execution stopped. */
      this.publishContinuationError({
        adminId: entry.adminId,
        projectSlug: entry.projectSlug,
        taskId: entry.taskId,
        sessionId: entry.sessionId,
        error
      });
    }
  }

  private async startNextQueuedTask(entry: KanbanSessionContinuationEntry, completedTask: KanbanTaskView): Promise<void> {
    /* Fresh sessions for the next queued task keep unrelated task context from leaking across completed work. */
    const tasks = await this.kanban.listTasks({ projectSlug: entry.projectSlug });
    const hasOtherActiveTask = tasks.some((task) => task.status === "in_progress" && task.id !== completedTask.id);
    if (hasOtherActiveTask) {
      return;
    }

    const queuedTaskExists = tasks.some((task) => task.status === "queued");
    if (!queuedTaskExists) {
      return;
    }

    const directory = this.projects.getProjectRootPath(entry.projectSlug);
    this.opencodeEvents.ensureDirectory(directory);
    await this.opencodeEvents.waitUntilConnected(directory);

    const created = await this.opencode.createSession({ directory });
    this.opencode.rememberSelectedSession({ directory, sessionID: created.id });
    this.sessionRouting.bind(created.id, { adminId: entry.adminId, directory });
    this.opencodeEvents.watchPermissionOnce({ directory, sessionID: created.id });

    /* Auto-created handoff sessions should stay visible in Telegram so operators understand why the thread rotated. */
    this.events.publish({
      type: "opencode.session.started",
      ts: new Date().toISOString(),
      data: {
        adminId: entry.adminId,
        projectSlug: entry.projectSlug,
        directory,
        sessionId: created.id,
        trigger: "kanban-session-handoff"
      }
    });

    const nextTask = await this.kanban.claimNextTask({
      agentId: completedTask.claimedBy?.trim() || DEFAULT_SESSION_AGENT_ID,
      projectSlug: entry.projectSlug,
      executionSessionId: created.id
    });
    if (!nextTask) {
      return;
    }

    publishKanbanTaskUpdated(this.events, {
      task: nextTask,
      source: "agent"
    });

    await this.promptQueue.enqueueSystemPrompt({
      adminId: entry.adminId,
      projectSlug: entry.projectSlug,
      directory,
      text: buildKanbanRunnerPrompt(nextTask)
    });

    this.events.publish({
      type: "kanban.session.handoff.triggered",
      ts: new Date().toISOString(),
      data: {
        adminId: entry.adminId,
        projectSlug: entry.projectSlug,
        taskId: completedTask.id,
        nextTaskId: nextTask.id,
        previousSessionId: entry.sessionId,
        nextSessionId: created.id
      }
    });
  }

  private async resolveSessionOwnedTask(input: {
    projectSlug: string;
    sessionId: string;
    taskId?: string;
  }): Promise<KanbanTaskView | null> {
    /* Session orchestration must target the latest matching in-progress/done card owned by the same OpenCode thread. */
    const tasks = await this.kanban.listTasks({ projectSlug: input.projectSlug });
    const matches = tasks.filter((task) => {
      if (input.taskId && task.id !== input.taskId) {
        return false;
      }

      return (
        task.executionSource === "session" &&
        task.executionSessionId === input.sessionId &&
        (task.status === "in_progress" || task.status === "done")
      );
    });
    if (matches.length === 0) {
      return null;
    }

    return matches.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null;
  }

  private async reconcilePersistedBarriers(): Promise<void> {
    /* Startup reconciliation prevents already-delivered final replies from permanently suppressing continuation. */
    const deliveredItemIds = new Set(
      this.outbox
        .listAll()
        .filter((item) => item.status === "delivered")
        .map((item) => item.id)
    );

    for (const entry of this.store.listAll()) {
      try {
        const pendingItemIds = entry.pendingItemIds.filter((itemId) => !deliveredItemIds.has(itemId));
        if (pendingItemIds.length > 0) {
          this.store.save({ ...entry, pendingItemIds });
          continue;
        }

        this.store.deleteSession(entry.sessionId);
        await this.triggerContinuation(entry);
      } catch (error) {
        /* One corrupted continuation entry must not block reconciliation for every other session. */
        this.publishContinuationError({
          adminId: entry.adminId,
          projectSlug: entry.projectSlug,
          taskId: entry.taskId,
          sessionId: entry.sessionId,
          error
        });
      }
    }
  }

  private suppressSessionContinuation(event: EventEnvelope): void {
    /* Manual stop explicitly suppresses automatic same-session continuation for the stopped thread. */
    const sessionId = String((event.data as any)?.sessionId ?? "").trim();
    if (!sessionId) {
      return;
    }

    this.store.deleteSession(sessionId);
    this.store.suppressSession(sessionId);
  }

  private releaseSuppressedSession(event: EventEnvelope): void {
    /* A new explicit turn in the same session means the operator resumed work intentionally, so auto-continuation may work again later. */
    const sessionId = String((event.data as any)?.sessionId ?? "").trim();
    if (!sessionId) {
      return;
    }

    this.store.clearSessionSuppression(sessionId);
  }

  private publishContinuationError(input: {
    adminId: number | null;
    projectSlug: string;
    taskId: string | null;
    sessionId: string;
    error: unknown;
  }): void {
    /* Error breadcrumbs keep automatic continuation diagnosable without crashing the event loop. */
    this.events.publish({
      type: "kanban.session.continuation.error",
      ts: new Date().toISOString(),
      data: {
        adminId: Number.isFinite(input.adminId) ? input.adminId : null,
        projectSlug: input.projectSlug,
        taskId: input.taskId,
        sessionId: input.sessionId,
        message: input.error instanceof Error ? input.error.message : String(input.error)
      }
    });
  }
}
