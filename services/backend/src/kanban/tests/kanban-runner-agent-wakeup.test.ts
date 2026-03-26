/**
 * @fileoverview Regression tests for waking kanban runner from agent-driven queued updates.
 *
 * Exports:
 * - none (Jest suite).
 */

import { EventEnvelope } from "../../events/events.types";
import { KanbanRunnerService, KANBAN_RUNNER_AGENT_ID } from "../kanban-runner.service";

const buildTask = (overrides?: Record<string, unknown>) => ({
  id: "task-1",
  projectSlug: "alpha",
  projectName: "Alpha",
  title: "Wake runner from agent queue event",
  description: "Agent queued work should wake the automation runner immediately.",
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

const createEventsServiceMock = () => {
  /* Keep publish synchronous so the runner reacts to queued updates exactly like the in-memory production bus. */
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
  /* Runner wake-ups stay fire-and-forget, so poll briefly for the side effect the agent event should trigger. */
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

  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for agent wake-up assertion");
};

describe("Kanban runner agent wake-up", () => {
  test("starts queued automation work when the queue update comes from agent flow", async () => {
    /* Agent-driven queued transitions happen in real OpenCode sessions, so filtering them out leaves the queue stuck. */
    const queuedTask = buildTask();
    const claimedTask = buildTask({
      status: "in_progress",
      claimedBy: KANBAN_RUNNER_AGENT_ID,
      executionSource: "runner",
      executionSessionId: "session-created"
    });
    const doneTask = buildTask({
      status: "done",
      claimedBy: null,
      executionSource: null,
      executionSessionId: null,
      resultSummary: "Runner completed agent-queued work"
    });

    /* Startup finds nothing, then the queued agent event should trigger a fresh project run. */
    const kanban = {
      listTasks: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([queuedTask])
        .mockResolvedValueOnce([doneTask]),
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
      createDetachedSession: jest.fn(async () => ({ id: "session-created" })),
      rememberSelectedSession: jest.fn(),
      sendPromptToSession: jest.fn(async () => ({
        sessionId: "session-created",
        responseText: "Started agent-queued task",
        info: {
          providerID: "provider",
          modelID: "model",
          mode: "primary",
          agent: "build",
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
        },
        parts: [{ type: "text", text: "Started agent-queued task" }]
      }))
    };
    const opencodeEvents = {
      ensureDirectory: jest.fn(),
      waitUntilConnected: jest.fn(async () => undefined)
    };
    const events = createEventsServiceMock();

    const runner = new KanbanRunnerService(
      { kanbanRunnerEnabled: true } as never,
      kanban as never,
      runnerSessions as never,
      projects as never,
      opencode as never,
      opencodeEvents as never,
      events as never
    );

    runner.onModuleInit();
    events.publish({
      type: "kanban.task.updated",
      ts: new Date().toISOString(),
      data: {
        taskId: "task-1",
        taskTitle: "Wake runner from agent queue event",
        projectSlug: "alpha",
        status: "queued",
        claimedBy: null,
        executionSource: null,
        source: "agent"
      }
    });

    await waitFor(() => {
      expect(opencode.sendPromptToSession).toHaveBeenCalledTimes(1);
    });

    expect(kanban.startTaskExecution).toHaveBeenCalledWith({
      taskId: "task-1",
      agentId: KANBAN_RUNNER_AGENT_ID,
      executionSource: "runner",
      executionSessionId: "session-created",
      leaseMs: 1_800_000
    });
  });
});
