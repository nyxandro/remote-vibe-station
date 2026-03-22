/**
 * @fileoverview Tests for delivery-backed kanban runner handoff release.
 *
 * Exports:
 * - none (Jest suite).
 */

import { EventEnvelope } from "../../events/events.types";
import { TelegramOutboxStore } from "../../telegram/outbox/telegram-outbox.store";
import { KanbanRunnerHandoffService } from "../kanban-runner-handoff.service";
import { KanbanRunnerHandoffStore } from "../kanban-runner-handoff.store";

const createEventsServiceMock = () => {
  /* Synchronous in-memory bus keeps release sequencing deterministic in tests. */
  const listeners = new Set<(event: EventEnvelope) => void>();

  return {
    publish: jest.fn((event: EventEnvelope) => {
      for (const listener of listeners) {
        listener(event);
      }
    }),
    subscribe: jest.fn((listener: (event: EventEnvelope) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    })
  };
};

describe("KanbanRunnerHandoffService", () => {
  test("releases runner handoff only after all final reply chunks are delivered", () => {
    /* Multi-chunk final answers must fully land in Telegram before the next task-start notification is allowed out. */
    const events = createEventsServiceMock();
    const store = new KanbanRunnerHandoffStore();
    const outbox = new TelegramOutboxStore();
    const service = new KanbanRunnerHandoffService(events as never, store, outbox);
    service.onModuleInit();

    events.publish({
      type: "telegram.assistant.reply.enqueued",
      ts: new Date().toISOString(),
      data: {
        sessionId: "session-1",
        deliveryGroupId: "group-1",
        itemIds: ["item-1", "item-2"]
      }
    });
    events.publish({
      type: "kanban.runner.finished",
      ts: new Date().toISOString(),
      data: {
        taskId: "task-1",
        projectSlug: "alpha",
        sessionId: "session-1",
        status: "done",
        claimedBy: null,
        executionSource: null
      }
    });

    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "kanban.runner.handoff.waiting",
        data: expect.objectContaining({
          projectSlug: "alpha",
          taskId: "task-1",
          sessionId: "session-1",
          deliveryGroupId: "group-1",
          pendingItemIds: ["item-1", "item-2"]
        })
      })
    );

    events.publish({
      type: "telegram.outbox.delivered",
      ts: new Date().toISOString(),
      data: {
        deliveryGroupId: "group-1",
        itemId: "item-1"
      }
    });
    expect(events.publish).not.toHaveBeenCalledWith(expect.objectContaining({ type: "kanban.runner.handoff.released" }));

    events.publish({
      type: "telegram.outbox.delivered",
      ts: new Date().toISOString(),
      data: {
        deliveryGroupId: "group-1",
        itemId: "item-2"
      }
    });

    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "kanban.runner.handoff.released",
        data: expect.objectContaining({
          projectSlug: "alpha",
          taskId: "task-1",
          sessionId: "session-1"
        })
      })
    );
  });

  test("trims queued final-reply item ids before storing the pending barrier", () => {
    /* Delivery-group matching must normalize whitespace so worker receipts can release the barrier reliably. */
    const events = createEventsServiceMock();
    const store = new KanbanRunnerHandoffStore();
    const outbox = new TelegramOutboxStore();
    const service = new KanbanRunnerHandoffService(events as never, store, outbox);
    service.onModuleInit();

    events.publish({
      type: "telegram.assistant.reply.enqueued",
      ts: new Date().toISOString(),
      data: {
        sessionId: "session-2",
        deliveryGroupId: "group-2",
        itemIds: [" item-3 ", "item-4  "]
      }
    });
    events.publish({
      type: "kanban.runner.finished",
      ts: new Date().toISOString(),
      data: {
        taskId: "task-2",
        projectSlug: "beta",
        sessionId: "session-2",
        status: "blocked",
        claimedBy: null,
        executionSource: null
      }
    });

    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "kanban.runner.handoff.waiting",
        data: expect.objectContaining({
          pendingItemIds: ["item-3", "item-4"]
        })
      })
    );
  });
});
