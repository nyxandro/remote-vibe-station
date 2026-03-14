/**
 * @fileoverview Tests for automatic kanban runner orchestration.
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
  title: "Implement runner",
  description: "Keep going until criteria are done.",
  status: "in_progress",
  priority: "high",
  acceptanceCriteria: [
    { id: "criterion-api", text: "API updated", status: "done" },
    { id: "criterion-ui", text: "UI updated", status: "pending" }
  ],
  resultSummary: null,
  blockedReason: null,
  createdAt: "2026-03-10T09:00:00.000Z",
  updatedAt: "2026-03-10T09:00:00.000Z",
  claimedBy: KANBAN_RUNNER_AGENT_ID,
  leaseUntil: "2026-03-10T12:00:00.000Z",
  ...overrides
});

const createEventsServiceMock = () => {
  /* Keep publish synchronous like the real in-memory bus so re-entrant runner scheduling stays testable. */
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
  /* Background runner work is kicked off without awaiting onModuleInit, so tests poll briefly for completion. */
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

  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for runner assertion");
};

describe("KanbanRunnerService", () => {
  test("runOnce resumes the runner-owned in-progress task in the same stored session before claiming a new one", async () => {
    /* Unfinished automation work must keep the same OpenCode session so task context survives runner wake-ups. */
    const kanban = {
      listTasks: jest.fn(async ({ projectSlug }: { projectSlug?: string | null } = {}) =>
        projectSlug === "alpha" ? [buildTask()] : [buildTask()]
      ),
      claimNextTask: jest.fn()
    };
    const runnerSessions = {
      getTaskSessionId: jest.fn(async () => "session-existing"),
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
      createDetachedSession: jest.fn(async () => ({ id: "session-1" })),
      sendPromptToSession: jest.fn(async () => ({
        sessionId: "session-existing",
        responseText: "Continuing task",
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

    expect(kanban.claimNextTask).not.toHaveBeenCalled();
    expect(opencode.createDetachedSession).not.toHaveBeenCalled();
    expect(opencode.sendPromptToSession).toHaveBeenCalledWith(
      expect.stringContaining("Continue kanban task task-1"),
      expect.objectContaining({ directory: "/srv/projects/alpha", sessionID: "session-existing" })
    );
  });

  test("runOnce claims the next queued task for automation when no active runner task exists", async () => {
    /* Idle projects with queued work should start automatically without waiting for a manual wake-up. */
    const claimedTask = buildTask({ id: "task-queued", status: "in_progress", claimedBy: KANBAN_RUNNER_AGENT_ID });
    const kanban = {
      listTasks: jest.fn(async ({ projectSlug }: { projectSlug?: string | null } = {}) =>
        projectSlug === "alpha"
          ? [buildTask({ id: "task-human", claimedBy: "manual-agent" }), buildTask({ id: "task-queued", status: "queued", claimedBy: null })]
          : [buildTask({ id: "task-queued", status: "queued", claimedBy: null })]
      ),
      claimNextTask: jest.fn(async () => claimedTask)
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
      createDetachedSession: jest.fn(async () => ({ id: "session-2" })),
      sendPromptToSession: jest.fn(async () => ({
        sessionId: "session-2",
        responseText: "Started task",
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

    expect(kanban.claimNextTask).toHaveBeenCalledWith({
      projectSlug: "alpha",
      agentId: KANBAN_RUNNER_AGENT_ID,
      leaseMs: 1_800_000
    });
    expect(opencode.createDetachedSession).toHaveBeenCalledWith({ directory: "/srv/projects/alpha" });
    expect(runnerSessions.setTaskSessionId).toHaveBeenCalledWith("task-queued", "session-2");
    expect(opencode.sendPromptToSession).toHaveBeenCalledWith(
      expect.stringContaining("Continue kanban task task-queued"),
      expect.objectContaining({ directory: "/srv/projects/alpha", sessionID: "session-2" })
    );
  });

  test("runOnce reuses an existing session for a queued task that was already in progress before", async () => {
    /* Re-claimed work should keep its prior session instead of starting from scratch after a pause. */
    const claimedTask = buildTask({ id: "task-returned", status: "in_progress", claimedBy: KANBAN_RUNNER_AGENT_ID });
    const kanban = {
      listTasks: jest.fn(async ({ projectSlug }: { projectSlug?: string | null } = {}) =>
        projectSlug === "alpha" ? [buildTask({ id: "task-returned", status: "queued", claimedBy: null })] : [buildTask({ id: "task-returned", status: "queued", claimedBy: null })]
      ),
      claimNextTask: jest.fn(async () => claimedTask)
    };
    const runnerSessions = {
      getTaskSessionId: jest.fn(async () => "session-returned"),
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
      createDetachedSession: jest.fn(async () => ({ id: "session-3" })),
      sendPromptToSession: jest.fn(async () => ({
        sessionId: "session-returned",
        responseText: "Resumed queued task",
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

    expect(opencode.createDetachedSession).not.toHaveBeenCalled();
    expect(opencode.sendPromptToSession).toHaveBeenCalledWith(
      expect.stringContaining("Continue kanban task task-returned"),
      expect.objectContaining({ directory: "/srv/projects/alpha", sessionID: "session-returned" })
    );
  });

  test("runner continues the same task immediately after its final OpenCode answer arrives", async () => {
    /* Final runner completion event should queue the next step without any interval polling delay. */
    const taskInProgress = buildTask();
    const taskDone = buildTask({ status: "done", claimedBy: null, leaseUntil: null });
    const kanban = {
      listTasks: jest
        .fn()
        .mockResolvedValueOnce([taskInProgress])
        .mockResolvedValueOnce([taskInProgress])
        .mockResolvedValueOnce([taskInProgress])
        .mockResolvedValueOnce([taskInProgress])
        .mockResolvedValueOnce([taskDone]),
      claimNextTask: jest.fn()
    };
    const runnerSessions = {
      getTaskSessionId: jest.fn(async () => "session-existing"),
      setTaskSessionId: jest.fn(async () => undefined)
    };
    const projects = {
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
    };
    const opencode = {
      createDetachedSession: jest.fn(async () => ({ id: "session-1" })),
      sendPromptToSession: jest
        .fn()
        .mockResolvedValueOnce({
          sessionId: "session-existing",
          responseText: "Первый финальный ответ",
          info: {
            providerID: "provider",
            modelID: "model",
            mode: "primary",
            agent: "build",
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
          },
          parts: [{ type: "text", text: "Первый финальный ответ" }]
        })
        .mockResolvedValueOnce({
          sessionId: "session-existing",
          responseText: "Второй финальный ответ",
          info: {
            providerID: "provider",
            modelID: "model",
            mode: "primary",
            agent: "build",
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
          },
          parts: [{ type: "text", text: "Второй финальный ответ" }]
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

    await waitFor(() => {
      expect(opencode.sendPromptToSession).toHaveBeenCalledTimes(2);
    });

    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "kanban.runner.finished",
        data: expect.objectContaining({
          taskId: "task-1",
          sessionId: "session-existing",
          finalText: expect.any(String)
        })
      })
    );
  });

  test("runner starts queued work when kanban task updates announce a new automation candidate", async () => {
    /* Fresh queued tasks must wake the runner immediately instead of waiting for a removed scheduler tick. */
    const queuedTask = buildTask({ status: "queued", claimedBy: null, leaseUntil: null });
    const claimedTask = buildTask({ status: "in_progress", claimedBy: KANBAN_RUNNER_AGENT_ID });
    const doneTask = buildTask({ status: "done", claimedBy: null, leaseUntil: null });
    const kanban = {
      listTasks: jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([queuedTask])
        .mockResolvedValueOnce([doneTask]),
      claimNextTask: jest.fn(async () => claimedTask)
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
      sendPromptToSession: jest.fn(async () => ({
        sessionId: "session-created",
        responseText: "Стартую задачу",
        info: {
          providerID: "provider",
          modelID: "model",
          mode: "primary",
          agent: "build",
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }
        },
        parts: [{ type: "text", text: "Стартую задачу" }]
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
        taskTitle: "Implement runner",
        projectSlug: "alpha",
        status: "queued",
        claimedBy: null
      }
    });

    await waitFor(() => {
      expect(opencode.sendPromptToSession).toHaveBeenCalledTimes(1);
    });

    expect(kanban.claimNextTask).toHaveBeenCalledWith({
      projectSlug: "alpha",
      agentId: KANBAN_RUNNER_AGENT_ID,
      leaseMs: 1_800_000
    });
  });
});
