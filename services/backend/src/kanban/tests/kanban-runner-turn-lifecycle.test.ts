/**
 * @fileoverview Tests for explicit runner turn lifecycle and final reply publication.
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
  title: "Keep long runner turn stable",
  description: "Do not lose final reply metadata or runtime turn state.",
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
  executionSessionId: "session-existing",
  ...overrides
});

const createEventsServiceMock = () => {
  /* Runner tests keep the in-memory bus synchronous so lifecycle assertions stay deterministic. */
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

describe("Kanban runner turn lifecycle", () => {
  test("publishes explicit turn start before continuing a reused runner session", async () => {
    /* Reused runner sessions must reopen Telegram runtime gate on every turn instead of relying on implicit session state. */
    const task = buildTask({ executionSessionId: "session-existing" });
    const kanban = {
      listTasks: jest.fn(async ({ projectSlug }: { projectSlug?: string | null } = {}) =>
        projectSlug === "alpha" ? [task] : [task]
      ),
      startTaskExecution: jest.fn()
    };
    const runnerSessions = {
      getTaskSessionId: jest.fn(async () => "session-existing"),
      setTaskSessionId: jest.fn(async () => undefined)
    };
    const projects = {
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha"),
      getActiveProject: jest.fn(async () => ({ slug: "alpha", rootPath: "/srv/projects/alpha" }))
    };
    const opencode = {
      isSessionBusy: jest.fn(async () => false),
      createDetachedSession: jest.fn(),
      rememberSelectedSession: jest.fn(),
      getModelContextLimit: jest.fn(async () => null),
      getModelDisplayName: jest.fn(async () => null),
      sendPromptToSession: jest.fn(async () => ({
        sessionId: "session-existing",
        responseText: "Runner final reply",
        info: {
          providerID: "cliproxy",
          modelID: "gpt-5.4",
          mode: "primary",
          agent: "build",
          tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }
        },
        parts: [{ type: "text", text: "Runner final reply" }]
      }))
    };
    const opencodeEvents = {
      ensureDirectory: jest.fn(),
      waitUntilConnected: jest.fn(async () => undefined)
    };
    const events = createEventsServiceMock();

    const runner = new KanbanRunnerService(
      { kanbanRunnerEnabled: true, adminIds: [649624756] } as never,
      kanban as never,
      runnerSessions as never,
      projects as never,
      opencode as never,
      opencodeEvents as never,
      events as never
    );

    await runner.runOnce("startup");

    const publishCalls = events.publish.mock.calls.map(([event]) => event as EventEnvelope);
    const turnStarted = publishCalls.find((event) => event.type === "opencode.turn.started");
    const finalMessage = publishCalls.find((event) => event.type === "opencode.message");

    expect(turnStarted).toMatchObject({
      data: {
        projectSlug: "alpha",
        directory: "/srv/projects/alpha",
        sessionId: "session-existing"
      }
    });
    expect(finalMessage).toMatchObject({
      data: {
        sessionId: "session-existing",
        finalText: "Runner final reply",
        providerID: "cliproxy",
        modelID: "gpt-5.4"
      }
    });
    expect(publishCalls.findIndex((event) => event.type === "opencode.turn.started")).toBeLessThan(
      publishCalls.findIndex((event) => event.type === "opencode.message")
    );
  });

  test("publishes final opencode.message for a freshly claimed runner task", async () => {
    /* Runner completions must use the same final-reply event path as normal prompt flow so footer metadata stays consistent. */
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
    const doneTask = buildTask({
      status: "done",
      claimedBy: null,
      leaseUntil: null,
      executionSessionId: "session-created",
      resultSummary: "Completed"
    });
    const kanban = {
      listTasks: jest
        .fn()
        .mockResolvedValueOnce([queuedTask])
        .mockResolvedValueOnce([queuedTask])
        .mockResolvedValueOnce([doneTask]),
      startTaskExecution: jest.fn(async () => claimedTask)
    };
    const runnerSessions = {
      getTaskSessionId: jest.fn(async () => null),
      setTaskSessionId: jest.fn(async () => undefined)
    };
    const projects = {
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha"),
      getActiveProject: jest.fn(async () => ({ slug: "alpha", rootPath: "/srv/projects/alpha" }))
    };
    const opencode = {
      isSessionBusy: jest.fn(async () => false),
      createDetachedSession: jest.fn(async () => ({ id: "session-created" })),
      rememberSelectedSession: jest.fn(),
      getModelContextLimit: jest.fn(async () => null),
      getModelDisplayName: jest.fn(async () => null),
      sendPromptToSession: jest.fn(async () => ({
        sessionId: "session-created",
        responseText: "Runner created fresh session and finished task",
        info: {
          providerID: "cliproxy",
          modelID: "gpt-5.4",
          mode: "primary",
          agent: "build",
          tokens: { input: 100, output: 200, reasoning: 10, cache: { read: 0, write: 0 } }
        },
        parts: [{ type: "text", text: "Runner created fresh session and finished task" }]
      }))
    };
    const opencodeEvents = {
      ensureDirectory: jest.fn(),
      waitUntilConnected: jest.fn(async () => undefined),
      watchPermissionOnce: jest.fn()
    };
    const sessionRouting = {
      bind: jest.fn()
    };
    const events = createEventsServiceMock();

    const runner = new KanbanRunnerService(
      { kanbanRunnerEnabled: true, adminIds: [649624756] } as never,
      kanban as never,
      runnerSessions as never,
      projects as never,
      opencode as never,
      opencodeEvents as never,
      events as never,
      sessionRouting as never
    );

    await runner.runOnce("startup");

    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "opencode.message",
        data: expect.objectContaining({
          sessionId: "session-created",
          finalText: "Runner created fresh session and finished task",
          providerID: "cliproxy",
          modelID: "gpt-5.4",
          tokens: { input: 100, output: 200, reasoning: 10, cache: { read: 0, write: 0 } }
        })
      })
    );
  });
});
