/**
 * @fileoverview Tests for handing project execution from one kanban task to the next.
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
  title: "Implement handoff",
  description: "Keep work serialized per project.",
  status: "in_progress",
  priority: "high",
  acceptanceCriteria: [{ id: "criterion-1", text: "Done", status: "pending" }],
  resultSummary: null,
  blockedReason: null,
  createdAt: "2026-03-10T09:00:00.000Z",
  updatedAt: "2026-03-10T09:00:00.000Z",
  claimedBy: KANBAN_RUNNER_AGENT_ID,
  leaseUntil: "2026-03-10T12:00:00.000Z",
  executionSource: "runner",
  executionSessionId: "session-runner",
  ...overrides
});

const createEventsServiceMock = () => {
  /* Tests keep the in-memory event bus synchronous so runner wake-ups are easy to reason about. */
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
  /* Runner callbacks are fire-and-forget, so tests poll briefly for the expected side effect. */
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

  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for runner handoff");
};

describe("Kanban runner handoff", () => {
  test("runOnce does not start queued work while another session-owned task is in progress", async () => {
    /* Project execution must stay strictly serialized, even when queued work already exists. */
    const sessionTask = buildTask({
      id: "task-session",
      claimedBy: "opencode-agent",
      executionSource: "session",
      executionSessionId: "session-human"
    });
    const queuedTask = buildTask({
      id: "task-queued",
      status: "queued",
      claimedBy: null,
      leaseUntil: null,
      executionSource: null,
      executionSessionId: null
    });
    const kanban = {
      listTasks: jest.fn(async () => [sessionTask, queuedTask]),
      startTaskExecution: jest.fn()
    };
    const runnerSessions = {
      getTaskSessionId: jest.fn(async () => null),
      setTaskSessionId: jest.fn(async () => undefined)
    };
    const projects = {
      list: jest.fn(async () => [
        {
          id: "alpha",
          slug: "alpha",
          name: "Alpha",
          rootPath: "/srv/projects/alpha",
          hasCompose: true,
          configured: true,
          runnable: true,
          status: "running"
        }
      ]),
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
    };
    const opencode = {
      createDetachedSession: jest.fn(),
      rememberSelectedSession: jest.fn(),
      sendPromptToSession: jest.fn()
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

    await runner.runOnce("startup");

    expect(kanban.startTaskExecution).not.toHaveBeenCalled();
    expect(opencode.sendPromptToSession).not.toHaveBeenCalled();
  });

  test("agent-side blocked event wakes runner to start the next queued task", async () => {
    /* Once the current task is blocked, the project should immediately move on to the next queued task. */
    const blockedTask = buildTask({
      id: "task-blocked",
      status: "blocked",
      claimedBy: null,
      leaseUntil: null,
      executionSource: null,
      executionSessionId: null,
      blockedReason: "Need dependency"
    });
    const queuedTask = buildTask({
      id: "task-queued",
      status: "queued",
      claimedBy: null,
      leaseUntil: null,
      executionSource: null,
      executionSessionId: null
    });
    const claimedTask = buildTask({
      id: "task-queued",
      title: "Implement next queued task",
      status: "in_progress",
      claimedBy: KANBAN_RUNNER_AGENT_ID,
      executionSource: "runner",
      executionSessionId: "session-queued"
    });
    const doneTask = buildTask({
      id: "task-queued",
      title: "Implement next queued task",
      status: "done",
      claimedBy: null,
      leaseUntil: null,
      executionSource: null,
      executionSessionId: null,
      resultSummary: "Finished handoff test"
    });

    let projectTasks: Array<ReturnType<typeof buildTask>> = [];
    const kanban = {
      listTasks: jest.fn(async () => projectTasks),
      startTaskExecution: jest.fn(async () => {
        projectTasks = [blockedTask, claimedTask];
        return claimedTask;
      })
    };
    const runnerSessions = {
      getTaskSessionId: jest.fn(async () => null),
      setTaskSessionId: jest.fn(async () => undefined)
    };
    const projects = {
      list: jest.fn(async () => []),
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
    };
    const opencode = {
      createDetachedSession: jest.fn(async () => ({ id: "session-queued" })),
      rememberSelectedSession: jest.fn(),
      sendPromptToSession: jest.fn(async () => {
        projectTasks = [blockedTask, doneTask];
        return {
          sessionId: "session-queued",
          responseText: "Started queued task",
          info: {
            providerID: "provider",
            modelID: "model",
            mode: "primary",
            agent: "build",
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
          },
          parts: []
        };
      })
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
    projectTasks = [blockedTask, queuedTask];

    events.publish({
      type: "kanban.task.updated",
      ts: new Date().toISOString(),
      data: {
        taskId: "task-blocked",
        taskTitle: "Blocked task",
        projectSlug: "alpha",
        status: "blocked",
        claimedBy: null,
        executionSource: null,
        source: "agent"
      }
    });

    await waitFor(() => {
      expect(opencode.sendPromptToSession).toHaveBeenCalledTimes(1);
    });

    expect(kanban.startTaskExecution).toHaveBeenCalledWith({
      taskId: "task-queued",
      agentId: KANBAN_RUNNER_AGENT_ID,
      executionSource: "runner",
      executionSessionId: "session-queued",
      leaseMs: 1_800_000
    });

    runner.onModuleDestroy();
  });
});
