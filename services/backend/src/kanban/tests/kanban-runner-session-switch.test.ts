/**
 * @fileoverview Tests for synchronizing Telegram-visible session context with kanban runner sessions.
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
  title: "Implement runner session switch",
  description: "Keep Telegram session context aligned with the active kanban task.",
  status: "in_progress",
  priority: "high",
  acceptanceCriteria: [{ id: "criterion-1", text: "Context switched", status: "pending" }],
  resultSummary: null,
  blockedReason: null,
  createdAt: "2026-03-10T09:00:00.000Z",
  updatedAt: "2026-03-10T09:00:00.000Z",
  claimedBy: KANBAN_RUNNER_AGENT_ID,
  leaseUntil: "2026-03-10T12:00:00.000Z",
  executionSource: "runner",
  executionSessionId: "session-existing",
  ...overrides
});

const createEventsServiceMock = () => {
  /* Keep the bus synchronous so tests can inspect the exact event payload emitted during one run. */
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

describe("Kanban runner session switch", () => {
  test("switches Telegram-visible active session when queued work starts with a fresh runner session", async () => {
    /* Fresh automation work must move Telegram to the same newly created thread instead of leaving the previous one active. */
    const queuedTask = buildTask({
      status: "queued",
      claimedBy: null,
      leaseUntil: null,
      executionSource: null,
      executionSessionId: null
    });
    const claimedTask = buildTask({
      executionSessionId: "session-created"
    });

    /* Runner should load queued work first, then re-read the project after the task claim and prompt execution. */
    const kanban = {
      listTasks: jest
        .fn()
        .mockResolvedValueOnce([queuedTask])
        .mockResolvedValueOnce([queuedTask])
        .mockResolvedValueOnce([claimedTask]),
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
      createDetachedSession: jest.fn(async () => ({ id: "session-created" })),
      rememberSelectedSession: jest.fn(),
      sendPromptToSession: jest.fn(async () => ({
        sessionId: "session-created",
        responseText: "Started task",
        info: {
          providerID: "provider",
          modelID: "model",
          mode: "primary",
          agent: "build",
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
        },
        parts: [{ type: "text", text: "Started task" }]
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

    await runner.runOnce("startup");

    expect(opencode.rememberSelectedSession).toHaveBeenCalledWith({
      directory: "/srv/projects/alpha",
      sessionID: "session-created"
    });
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "kanban.runner.finished",
        data: expect.objectContaining({
          action: "started",
          sessionId: "session-created",
          startedNewSession: true
        })
      })
    );
  });

  test("does not announce a new session when queued work reuses an existing stored runner thread", async () => {
    /* Reclaimed tasks should keep their prior session quietly instead of pretending that a fresh thread was created. */
    const queuedTask = buildTask({
      id: "task-returned",
      status: "queued",
      claimedBy: null,
      leaseUntil: null,
      executionSource: null,
      executionSessionId: null
    });
    const claimedTask = buildTask({
      id: "task-returned",
      executionSessionId: "session-returned"
    });

    /* Stored task session should be reused directly, so Telegram active-session cache must stay unchanged. */
    const kanban = {
      listTasks: jest
        .fn()
        .mockResolvedValueOnce([queuedTask])
        .mockResolvedValueOnce([queuedTask])
        .mockResolvedValueOnce([claimedTask]),
      startTaskExecution: jest.fn(async () => claimedTask)
    };
    const runnerSessions = {
      getTaskSessionId: jest.fn(async () => "session-returned"),
      setTaskSessionId: jest.fn(async () => undefined)
    };
    const projects = {
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
    };
    const opencode = {
      createDetachedSession: jest.fn(),
      rememberSelectedSession: jest.fn(),
      sendPromptToSession: jest.fn(async () => ({
        sessionId: "session-returned",
        responseText: "Resumed task",
        info: {
          providerID: "provider",
          modelID: "model",
          mode: "primary",
          agent: "build",
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
        },
        parts: [{ type: "text", text: "Resumed task" }]
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

    await runner.runOnce("startup");

    expect(opencode.rememberSelectedSession).not.toHaveBeenCalled();
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "kanban.runner.finished",
        data: expect.objectContaining({
          action: "started",
          sessionId: "session-returned",
          startedNewSession: false
        })
      })
    );
  });
});
