/**
 * @fileoverview Tests for automatic kanban runner orchestration.
 *
 * Exports:
 * - none (Jest suite).
 */

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
    const events = { publish: jest.fn() };

    const runner = new KanbanRunnerService(
      { kanbanRunnerEnabled: true, kanbanRunnerIntervalMs: 60_000 } as never,
      kanban as never,
      runnerSessions as never,
      projects as never,
      opencode as never,
      opencodeEvents as never,
      events as never
    );

    await runner.runOnce("interval");

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
    const events = { publish: jest.fn() };

    const runner = new KanbanRunnerService(
      { kanbanRunnerEnabled: true, kanbanRunnerIntervalMs: 60_000 } as never,
      kanban as never,
      runnerSessions as never,
      projects as never,
      opencode as never,
      opencodeEvents as never,
      events as never
    );

    await runner.runOnce("interval");

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
    const events = { publish: jest.fn() };

    const runner = new KanbanRunnerService(
      { kanbanRunnerEnabled: true, kanbanRunnerIntervalMs: 60_000 } as never,
      kanban as never,
      runnerSessions as never,
      projects as never,
      opencode as never,
      opencodeEvents as never,
      events as never
    );

    await runner.runOnce("interval");

    expect(opencode.createDetachedSession).not.toHaveBeenCalled();
    expect(opencode.sendPromptToSession).toHaveBeenCalledWith(
      expect.stringContaining("Continue kanban task task-returned"),
      expect.objectContaining({ directory: "/srv/projects/alpha", sessionID: "session-returned" })
    );
  });
});
