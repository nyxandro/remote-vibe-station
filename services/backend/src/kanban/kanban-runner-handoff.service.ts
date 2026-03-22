/**
 * @fileoverview Delivery-backed release barrier between one kanban runner task and the next.
 *
 * Exports:
 * - KanbanRunnerHandoffService - Waits for final Telegram reply delivery before releasing next task handoff.
 */

import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { EventEnvelope } from "../events/events.types";
import { EventsService } from "../events/events.service";
import { TelegramOutboxStore } from "../telegram/outbox/telegram-outbox.store";
import { KanbanRunnerHandoffStore } from "./kanban-runner-handoff.store";

const RECENT_REPLY_TTL_MS = 10 * 60 * 1000;

type RecentReply = {
  deliveryGroupId: string;
  itemIds: string[];
  createdAtMs: number;
};

@Injectable()
export class KanbanRunnerHandoffService implements OnModuleInit, OnModuleDestroy {
  private readonly recentRepliesBySession = new Map<string, RecentReply>();
  private unsubscribe?: () => void;

  public constructor(
    private readonly events: EventsService,
    private readonly store: KanbanRunnerHandoffStore,
    private readonly outbox: TelegramOutboxStore
  ) {}

  public onModuleInit(): void {
    /* Subscribe once and reconcile persisted barriers against current outbox delivery state. */
    this.unsubscribe = this.events.subscribe((event) => this.onEvent(event));
    this.reconcilePersistedBarriers();
  }

  public onModuleDestroy(): void {
    /* Tests and process shutdown should detach the event listener cleanly. */
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private onEvent(event: EventEnvelope): void {
    if (event.type === "telegram.assistant.reply.enqueued") {
      this.rememberRecentReply(event);
      return;
    }

    if (event.type === "kanban.runner.finished") {
      this.capturePendingHandoff(event);
      return;
    }

    if (event.type === "telegram.outbox.delivered") {
      this.releaseDeliveredBarrier(event);
    }
  }

  private rememberRecentReply(event: EventEnvelope): void {
    /* Runner finish arrives after final reply enqueue, so cache the just-enqueued delivery group by session briefly. */
    this.pruneRecentReplies(Date.now());
    const sessionId = String((event.data as any)?.sessionId ?? "").trim();
    const deliveryGroupId = String((event.data as any)?.deliveryGroupId ?? "").trim();
    const itemIds = Array.isArray((event.data as any)?.itemIds)
      ? (event.data as any).itemIds
          .map((item: unknown) => (typeof item === "string" ? item.trim() : ""))
          .filter((item: string) => item.length > 0)
      : [];
    if (!sessionId || !deliveryGroupId || itemIds.length === 0) {
      return;
    }

    this.recentRepliesBySession.set(sessionId, {
      deliveryGroupId,
      itemIds,
      createdAtMs: Date.now()
    });
  }

  private capturePendingHandoff(event: EventEnvelope): void {
    /* Only done/blocked runner turns need a delivery barrier before the next queued task may start. */
    const projectSlug = String((event.data as any)?.projectSlug ?? "").trim();
    const taskId = String((event.data as any)?.taskId ?? "").trim();
    const sessionId = String((event.data as any)?.sessionId ?? "").trim();
    const status = String((event.data as any)?.status ?? "").trim();
    if (!projectSlug || !taskId || !sessionId || (status !== "done" && status !== "blocked")) {
      return;
    }

    this.pruneRecentReplies(Date.now());
    const recentReply = this.recentRepliesBySession.get(sessionId);
    if (!recentReply) {
      /* Missing reply metadata must not deadlock automation when there is nothing Telegram-bound to wait for. */
      this.store.deleteProject(projectSlug);
      this.publishRelease({ projectSlug, taskId, sessionId, deliveryGroupId: null });
      return;
    }

    this.store.save({
      projectSlug,
      taskId,
      sessionId,
      deliveryGroupId: recentReply.deliveryGroupId,
      pendingItemIds: [...recentReply.itemIds],
      createdAt: new Date().toISOString()
    });

    /* Waiting breadcrumb makes the delivery barrier visible in the event log before the next task is released. */
    this.events.publish({
      type: "kanban.runner.handoff.waiting",
      ts: new Date().toISOString(),
      data: {
        projectSlug,
        taskId,
        sessionId,
        deliveryGroupId: recentReply.deliveryGroupId,
        pendingItemIds: [...recentReply.itemIds]
      }
    });
  }

  private releaseDeliveredBarrier(event: EventEnvelope): void {
    /* Delivery confirmations advance handoff barriers chunk-by-chunk until the whole final reply lands. */
    const deliveryGroupId = String((event.data as any)?.deliveryGroupId ?? "").trim();
    const itemId = String((event.data as any)?.itemId ?? "").trim();
    if (!deliveryGroupId || !itemId) {
      return;
    }

    const released = this.store.markDelivered({ deliveryGroupId, itemId });
    if (!released) {
      return;
    }

    this.publishRelease({
      projectSlug: released.projectSlug,
      taskId: released.taskId,
      sessionId: released.sessionId,
      deliveryGroupId: released.deliveryGroupId
    });
  }

  private reconcilePersistedBarriers(): void {
    /* Startup reconciliation prevents already-delivered final replies from blocking the next task forever. */
    const deliveredItemIds = new Set(
      this.outbox
        .listAll()
        .filter((item) => item.status === "delivered")
        .map((item) => item.id)
    );

    for (const entry of this.store.listAll()) {
      const pendingItemIds = entry.pendingItemIds.filter((itemId) => !deliveredItemIds.has(itemId));
      if (pendingItemIds.length > 0) {
        this.store.save({ ...entry, pendingItemIds });
        continue;
      }

      this.store.deleteProject(entry.projectSlug);
      this.publishRelease({
        projectSlug: entry.projectSlug,
        taskId: entry.taskId,
        sessionId: entry.sessionId,
        deliveryGroupId: entry.deliveryGroupId
      });
    }
  }

  private publishRelease(input: {
    projectSlug: string;
    taskId: string;
    sessionId: string;
    deliveryGroupId: string | null;
  }): void {
    /* Release signal is the single canonical point where the next queued task becomes eligible to start. */
    this.events.publish({
      type: "kanban.runner.handoff.released",
      ts: new Date().toISOString(),
      data: {
        projectSlug: input.projectSlug,
        taskId: input.taskId,
        sessionId: input.sessionId,
        deliveryGroupId: input.deliveryGroupId
      }
    });
  }

  private pruneRecentReplies(nowMs: number): void {
    /* Session-scoped delivery cache only needs to bridge the tiny gap until runner.finished arrives. */
    for (const [sessionId, value] of this.recentRepliesBySession.entries()) {
      if (nowMs - value.createdAtMs <= RECENT_REPLY_TTL_MS) {
        continue;
      }
      this.recentRepliesBySession.delete(sessionId);
    }
  }
}
