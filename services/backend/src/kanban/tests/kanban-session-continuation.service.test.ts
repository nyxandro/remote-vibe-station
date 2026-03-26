/**
 * @fileoverview Tests for delivery-backed continuation of unfinished session-owned kanban tasks.
 *
 * Exports:
 * - none (Jest suite).
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { EventEnvelope } from "../../events/events.types";
import { TelegramOutboxStore } from "../../telegram/outbox/telegram-outbox.store";
import { KanbanSessionContinuationService } from "../kanban-session-continuation.service";
import { KanbanSessionContinuationStore } from "../kanban-session-continuation.store";

const TEST_DATA_DIR = path.join(process.cwd(), "data");
const CONTINUATION_PATH = path.join(TEST_DATA_DIR, "kanban.session.continuation.json");

const buildTask = (overrides?: Record<string, unknown>) => ({
  /* Keep one realistic kanban task shape so continuation tests focus on event sequencing. */
  id: "task-1",
  projectSlug: "alpha",
  projectName: "Alpha",
  title: "Finish kanban task",
  description: "Keep going until every acceptance criterion is done.",
  status: "in_progress",
  priority: "high",
  acceptanceCriteria: [
    { id: "criterion-1", text: "Already done", status: "done", blockedReason: null },
    { id: "criterion-2", text: "Still pending", status: "pending", blockedReason: null }
  ],
  resultSummary: null,
  blockedReason: null,
  createdAt: "2026-03-26T06:00:00.000Z",
  updatedAt: "2026-03-26T06:30:00.000Z",
  claimedBy: "opencode",
  leaseUntil: "2026-03-26T08:30:00.000Z",
  executionSource: "session",
  executionSessionId: "session-1",
  blockedResumeStatus: null,
  statusTimeline: [{ status: "in_progress", changedAt: "2026-03-26T06:10:00.000Z" }],
  ...overrides
});

const buildQueuedTask = (overrides?: Record<string, unknown>) =>
  buildTask({
    id: "task-2",
    title: "Next queued task",
    description: "Start the next queued item in a fresh session.",
    status: "queued",
    claimedBy: null,
    leaseUntil: null,
    executionSource: null,
    executionSessionId: null,
    acceptanceCriteria: [{ id: "criterion-3", text: "Finish next task", status: "pending", blockedReason: null }],
    ...overrides
  });

const createEventsServiceMock = () => {
  /* Synchronous in-memory bus keeps release sequencing deterministic for continuation tests. */
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

const waitFor = async (assertion: () => void | Promise<void>): Promise<void> => {
  /* Continuation release happens off the synchronous publish path, so tests poll briefly for the side effect. */
  const timeoutAt = Date.now() + 1_000;
  let lastError: unknown;

  while (Date.now() < timeoutAt) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for session continuation assertion");
};

describe("KanbanSessionContinuationService", () => {
  beforeEach(() => {
    /* Reset persisted continuation state before every test. */
    fs.rmSync(CONTINUATION_PATH, { force: true });
  });

  afterEach(() => {
    /* Cleanup keeps file-backed stores isolated across tests. */
    fs.rmSync(CONTINUATION_PATH, { force: true });
  });

  test("continues the same session only after the final Telegram reply is fully delivered", async () => {
    /* Session-owned work must keep going in the same chat thread when the task is still in progress. */
    const events = createEventsServiceMock();
    const store = new KanbanSessionContinuationStore();
    const outbox = new TelegramOutboxStore();
    const kanban = {
      listTasks: jest.fn(async ({ projectSlug }: { projectSlug?: string | null } = {}) =>
        projectSlug === "alpha" ? [buildTask()] : [buildTask()]
      ),
      claimNextTask: jest.fn()
    };
    const projects = {
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
    };
    const opencode = {
      selectSession: jest.fn(async () => undefined),
      createSession: jest.fn(async () => ({ id: "session-2" })),
      rememberSelectedSession: jest.fn()
    };
    const sessionRouting = {
      bind: jest.fn()
    };
    const opencodeEvents = {
      ensureDirectory: jest.fn(),
      waitUntilConnected: jest.fn(async () => undefined),
      watchPermissionOnce: jest.fn()
    };
    const queue = {
      enqueueSystemPrompt: jest.fn(async () => ({ position: 1 }))
    };

    const service = new KanbanSessionContinuationService(
      events as never,
      store,
      outbox,
      kanban as never,
      projects as never,
      opencode as never,
      sessionRouting as never,
      opencodeEvents as never,
      queue as never
    );
    service.onModuleInit();

    events.publish({
      type: "telegram.assistant.reply.enqueued",
      ts: new Date().toISOString(),
      data: {
        adminId: 7,
        projectSlug: "alpha",
        sessionId: "session-1",
        deliveryGroupId: "group-1",
        itemIds: ["item-1", "item-2"]
      }
    });

    await waitFor(() => {
      expect(events.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "kanban.session.continuation.waiting",
          data: expect.objectContaining({
            adminId: 7,
            projectSlug: "alpha",
            taskId: "task-1",
            sessionId: "session-1",
            pendingItemIds: ["item-1", "item-2"]
          })
        })
      );
    });

    events.publish({
      type: "telegram.outbox.delivered",
      ts: new Date().toISOString(),
      data: {
        deliveryGroupId: "group-1",
        itemId: "item-1"
      }
    });
    expect(queue.enqueueSystemPrompt).not.toHaveBeenCalled();

    events.publish({
      type: "telegram.outbox.delivered",
      ts: new Date().toISOString(),
      data: {
        deliveryGroupId: "group-1",
        itemId: "item-2"
      }
    });

    await waitFor(() => {
      expect(opencode.selectSession).toHaveBeenCalledWith({
        directory: "/srv/projects/alpha",
        sessionID: "session-1"
      });
      expect(queue.enqueueSystemPrompt).toHaveBeenCalledWith({
        adminId: 7,
        projectSlug: "alpha",
        directory: "/srv/projects/alpha",
        text: expect.stringContaining("Continue the current kanban task task-1")
      });
    });
  });

  test("does not continue tasks that are no longer in progress after the reply is delivered", async () => {
    /* Finished or blocked tasks should stop naturally instead of being pinged again. */
    const events = createEventsServiceMock();
    const store = new KanbanSessionContinuationStore();
    const outbox = new TelegramOutboxStore();
    const kanban = {
      listTasks: jest.fn(async ({ projectSlug }: { projectSlug?: string | null } = {}) =>
        projectSlug === "alpha" ? [buildTask({ status: "done", claimedBy: null, executionSessionId: null, leaseUntil: null })] : []
      ),
      claimNextTask: jest.fn()
    };
    const projects = {
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
    };
    const opencode = {
      selectSession: jest.fn(async () => undefined),
      createSession: jest.fn(async () => ({ id: "session-2" })),
      rememberSelectedSession: jest.fn()
    };
    const sessionRouting = {
      bind: jest.fn()
    };
    const opencodeEvents = {
      ensureDirectory: jest.fn(),
      waitUntilConnected: jest.fn(async () => undefined),
      watchPermissionOnce: jest.fn()
    };
    const queue = {
      enqueueSystemPrompt: jest.fn(async () => ({ position: 1 }))
    };

    const service = new KanbanSessionContinuationService(
      events as never,
      store,
      outbox,
      kanban as never,
      projects as never,
      opencode as never,
      sessionRouting as never,
      opencodeEvents as never,
      queue as never
    );
    service.onModuleInit();

    events.publish({
      type: "telegram.assistant.reply.enqueued",
      ts: new Date().toISOString(),
      data: {
        adminId: 7,
        projectSlug: "alpha",
        sessionId: "session-1",
        deliveryGroupId: "group-2",
        itemIds: ["item-3"]
      }
    });
    events.publish({
      type: "telegram.outbox.delivered",
      ts: new Date().toISOString(),
      data: {
        deliveryGroupId: "group-2",
        itemId: "item-3"
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(queue.enqueueSystemPrompt).not.toHaveBeenCalled();
    expect(opencode.selectSession).not.toHaveBeenCalled();
  });

  test("starts the next queued task in a fresh session after a done task reply is fully delivered", async () => {
    /* Once the current session-owned task is done, the next queued task should begin in a new clean OpenCode session. */
    const events = createEventsServiceMock();
    const store = new KanbanSessionContinuationStore();
    const outbox = new TelegramOutboxStore();
    const doneTask = buildTask({ status: "done", leaseUntil: null });
    const claimedNextTask = buildQueuedTask({
      status: "in_progress",
      claimedBy: "opencode-agent",
      executionSource: "session",
      executionSessionId: "session-2",
      leaseUntil: "2026-03-26T08:45:00.000Z"
    });
    const kanban = {
      listTasks: jest.fn(async ({ projectSlug }: { projectSlug?: string | null } = {}) =>
        projectSlug === "alpha" ? [doneTask, buildQueuedTask()] : [doneTask, buildQueuedTask()]
      ),
      claimNextTask: jest.fn(async () => claimedNextTask)
    };
    const projects = {
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
    };
    const opencode = {
      selectSession: jest.fn(async () => undefined),
      createSession: jest.fn(async () => ({ id: "session-2" })),
      rememberSelectedSession: jest.fn()
    };
    const sessionRouting = {
      bind: jest.fn()
    };
    const opencodeEvents = {
      ensureDirectory: jest.fn(),
      waitUntilConnected: jest.fn(async () => undefined),
      watchPermissionOnce: jest.fn()
    };
    const queue = {
      enqueueSystemPrompt: jest.fn(async () => ({ position: 1 }))
    };

    const service = new KanbanSessionContinuationService(
      events as never,
      store,
      outbox,
      kanban as never,
      projects as never,
      opencode as never,
      sessionRouting as never,
      opencodeEvents as never,
      queue as never
    );
    service.onModuleInit();

    events.publish({
      type: "telegram.assistant.reply.enqueued",
      ts: new Date().toISOString(),
      data: {
        adminId: 7,
        projectSlug: "alpha",
        sessionId: "session-1",
        deliveryGroupId: "group-done",
        itemIds: ["item-done"]
      }
    });

    await waitFor(() => {
      expect(events.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "kanban.session.continuation.waiting",
          data: expect.objectContaining({
            taskId: "task-1",
            sessionId: "session-1",
            pendingItemIds: ["item-done"]
          })
        })
      );
    });

    events.publish({
      type: "telegram.outbox.delivered",
      ts: new Date().toISOString(),
      data: {
        deliveryGroupId: "group-done",
        itemId: "item-done"
      }
    });

    await waitFor(() => {
      expect(opencode.createSession).toHaveBeenCalledWith({ directory: "/srv/projects/alpha" });
      expect(kanban.claimNextTask).toHaveBeenCalledWith({
        agentId: "opencode",
        projectSlug: "alpha",
        executionSessionId: "session-2"
      });
      expect(queue.enqueueSystemPrompt).toHaveBeenCalledWith({
        adminId: 7,
        projectSlug: "alpha",
        directory: "/srv/projects/alpha",
        text: expect.stringContaining("Continue kanban task task-2")
      });
    });
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "opencode.session.started",
        data: expect.objectContaining({
          adminId: 7,
          projectSlug: "alpha",
          sessionId: "session-2"
        })
      })
    );
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "kanban.session.handoff.triggered",
        data: expect.objectContaining({
          taskId: "task-1",
          nextTaskId: "task-2",
          previousSessionId: "session-1",
          nextSessionId: "session-2"
        })
      })
    );
  });

  test("does not continue a session-owned task after the operator manually stops that same session", async () => {
    /* Manual stop must suppress automatic same-session wakeups even if the previous final reply finishes delivering later. */
    const events = createEventsServiceMock();
    const store = new KanbanSessionContinuationStore();
    const outbox = new TelegramOutboxStore();
    const kanban = {
      listTasks: jest.fn(async ({ projectSlug }: { projectSlug?: string | null } = {}) =>
        projectSlug === "alpha" ? [buildTask()] : [buildTask()]
      ),
      claimNextTask: jest.fn()
    };
    const projects = {
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
    };
    const opencode = {
      selectSession: jest.fn(async () => undefined),
      createSession: jest.fn(async () => ({ id: "session-2" })),
      rememberSelectedSession: jest.fn()
    };
    const sessionRouting = {
      bind: jest.fn()
    };
    const opencodeEvents = {
      ensureDirectory: jest.fn(),
      waitUntilConnected: jest.fn(async () => undefined),
      watchPermissionOnce: jest.fn()
    };
    const queue = {
      enqueueSystemPrompt: jest.fn(async () => ({ position: 1 }))
    };

    const service = new KanbanSessionContinuationService(
      events as never,
      store,
      outbox,
      kanban as never,
      projects as never,
      opencode as never,
      sessionRouting as never,
      opencodeEvents as never,
      queue as never
    );
    service.onModuleInit();

    events.publish({
      type: "telegram.assistant.reply.enqueued",
      ts: new Date().toISOString(),
      data: {
        adminId: 7,
        projectSlug: "alpha",
        sessionId: "session-1",
        deliveryGroupId: "group-stop",
        itemIds: ["item-stop"]
      }
    });

    await waitFor(() => {
      expect(events.publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: "kanban.session.continuation.waiting" })
      );
    });

    events.publish({
      type: "opencode.session.stopped",
      ts: new Date().toISOString(),
      data: {
        adminId: 7,
        projectSlug: "alpha",
        directory: "/srv/projects/alpha",
        sessionId: "session-1",
        aborted: true
      }
    });
    events.publish({
      type: "telegram.outbox.delivered",
      ts: new Date().toISOString(),
      data: {
        deliveryGroupId: "group-stop",
        itemId: "item-stop"
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(queue.enqueueSystemPrompt).not.toHaveBeenCalled();
    expect(opencode.selectSession).not.toHaveBeenCalled();
  });
});
