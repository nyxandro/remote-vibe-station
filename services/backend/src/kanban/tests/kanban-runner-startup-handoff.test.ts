/**
 * @fileoverview Regression tests for startup behavior while a runner handoff barrier is still pending.
 *
 * Exports:
 * - none (Jest suite).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { KanbanRunnerHandoffStore } from "../kanban-runner-handoff.store";
import { KanbanRunnerService } from "../kanban-runner.service";

const buildTask = (overrides?: Record<string, unknown>) => ({
  id: "task-queued",
  projectSlug: "alpha",
  projectName: "Alpha",
  title: "Queued task behind startup handoff barrier",
  description: "Runner should not start this task until the previous final reply is delivered.",
  status: "queued",
  priority: "high",
  acceptanceCriteria: [{ id: "criterion-1", text: "Done", status: "pending" }],
  resultSummary: null,
  blockedReason: null,
  createdAt: "2026-03-10T09:00:00.000Z",
  updatedAt: "2026-03-10T09:00:00.000Z",
  claimedBy: null,
  leaseUntil: null,
  executionSource: null,
  executionSessionId: null,
  ...overrides
});

describe("Kanban runner startup handoff barrier", () => {
  test("does not start the next queued task on startup while the previous final reply is still pending delivery", async () => {
    /* Backend restarts must honor the persisted delivery barrier or the next task starts before Telegram sees the previous final answer. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-kanban-runner-startup-handoff-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      /* Persist the same barrier snapshot the handoff service would leave on disk before a backend restart. */
      const handoffStore = new KanbanRunnerHandoffStore();
      handoffStore.save({
        projectSlug: "alpha",
        taskId: "task-finished",
        sessionId: "session-finished",
        deliveryGroupId: "group-1",
        pendingItemIds: ["item-1"],
        createdAt: "2026-03-22T12:47:28.236Z"
      });

      const queuedTask = buildTask();
      const claimedTask = buildTask({
        status: "in_progress",
        claimedBy: "kanban-runner",
        executionSource: "runner",
        executionSessionId: "session-next"
      });

      /* Startup should inspect queued work but must stop before creating or claiming a new session while the barrier exists. */
      const kanban = {
        listTasks: jest.fn(async () => [queuedTask]),
        startTaskExecution: jest.fn(async () => claimedTask)
      };
      const runnerSessions = {
        getTaskSessionId: jest.fn(async () => null),
        setTaskSessionId: jest.fn(async () => undefined)
      };
      const projects = {
        getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
      };
      const opencode = {
        isSessionBusy: jest.fn(async () => false),
        createDetachedSession: jest.fn(async () => ({ id: "session-next" })),
        rememberSelectedSession: jest.fn(),
        sendPromptToSession: jest.fn(async () => ({
          sessionId: "session-next",
          responseText: "Started next task too early",
          info: {
            providerID: "provider",
            modelID: "model",
            mode: "primary",
            agent: "build",
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
          },
          parts: []
        }))
      };
      const opencodeEvents = {
        ensureDirectory: jest.fn(),
        waitUntilConnected: jest.fn(async () => undefined)
      };
      const events = {
        publish: jest.fn(),
        subscribe: jest.fn(() => () => undefined)
      };

      const runner = new KanbanRunnerService(
        { kanbanRunnerEnabled: true } as never,
        kanban as never,
        runnerSessions as never,
        projects as never,
        opencode as never,
        opencodeEvents as never,
        events as never,
        undefined,
        undefined,
        handoffStore
      );

      await runner.runOnce("startup");

      expect(kanban.listTasks).toHaveBeenCalled();
      expect(opencode.createDetachedSession).not.toHaveBeenCalled();
      expect(kanban.startTaskExecution).not.toHaveBeenCalled();
      expect(opencode.sendPromptToSession).not.toHaveBeenCalled();
    } finally {
      process.chdir(prev);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
