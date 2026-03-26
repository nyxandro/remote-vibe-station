/**
 * @fileoverview Regression tests for safe agent-side kanban refinement semantics.
 *
 * Exports:
 * - none (Jest suite).
 */

import { KanbanAgentController } from "../kanban-agent.controller";

const createTask = (overrides?: Record<string, unknown>) => ({
  /* Return a stable task shape so controller tests can focus on the outgoing service patch. */
  id: "task-1",
  projectSlug: "alpha",
  projectName: "Alpha",
  title: "Protect checklist",
  description: "Keep acceptance criteria intact while moving status.",
  status: "queued",
  priority: "medium",
  acceptanceCriteria: [{ id: "criterion-1", text: "Criteria survive refinement", status: "pending", blockedReason: null }],
  resultSummary: null,
  blockedReason: null,
  createdAt: "2026-03-26T10:00:00.000Z",
  updatedAt: "2026-03-26T10:00:00.000Z",
  claimedBy: "opencode-agent",
  leaseUntil: "2026-03-26T12:00:00.000Z",
  executionSource: "session",
  executionSessionId: "session-1",
  blockedResumeStatus: null,
  statusTimeline: [{ status: "queued", changedAt: "2026-03-26T10:00:00.000Z" }],
  ...overrides
});

const createController = () => {
  /* Keep collaborators tiny because these tests care only about agent refine payload shaping. */
  const kanban = {
    startTaskExecution: jest.fn(async () => createTask({ status: "in_progress" })),
    updateTaskFromExecution: jest.fn(async (input: { patch: Record<string, unknown> }) => createTask(input.patch))
  };
  const events = {
    publish: jest.fn()
  };

  return {
    controller: new KanbanAgentController(kanban as never, events as never),
    kanban,
    events
  };
};

describe("KanbanAgentController refineTask", () => {
  test("ignores accidental empty acceptanceCriteria arrays while still updating task status", async () => {
    /* Agents often send [] when they mean unchanged, so the controller must not treat that as destructive deletion. */
    const { controller, kanban } = createController();

    await controller.refineTask("task-1", {
      agentId: "opencode-agent",
      sessionId: "session-1",
      status: "ready",
      acceptanceCriteria: []
    });

    expect(kanban.updateTaskFromExecution).toHaveBeenCalledWith({
      taskId: "task-1",
      actor: {
        agentId: "opencode-agent",
        sessionId: "session-1",
        source: "session"
      },
      patch: {
        status: "ready"
      }
    });
  });

  test("forwards an explicit checklist clear request only when clearAcceptanceCriteria is true", async () => {
    /* Destructive checklist clearing must require explicit intent instead of overloading an empty array. */
    const { controller, kanban } = createController();

    await controller.refineTask("task-1", {
      agentId: "opencode-agent",
      sessionId: "session-1",
      status: "ready",
      acceptanceCriteria: [],
      clearAcceptanceCriteria: true
    });

    expect(kanban.updateTaskFromExecution).toHaveBeenCalledWith({
      taskId: "task-1",
      actor: {
        agentId: "opencode-agent",
        sessionId: "session-1",
        source: "session"
      },
      patch: {
        status: "ready",
        acceptanceCriteria: []
      }
    });
  });

  test("treats clearAcceptanceCriteria without an explicit array as an intentional empty checklist", async () => {
    /* The clear flag already expresses destructive intent, so callers should not need to duplicate an empty array. */
    const { controller, kanban } = createController();

    await controller.refineTask("task-1", {
      agentId: "opencode-agent",
      sessionId: "session-1",
      status: "ready",
      clearAcceptanceCriteria: true
    });

    expect(kanban.updateTaskFromExecution).toHaveBeenCalledWith({
      taskId: "task-1",
      actor: {
        agentId: "opencode-agent",
        sessionId: "session-1",
        source: "session"
      },
      patch: {
        status: "ready",
        acceptanceCriteria: []
      }
    });
  });

  test("does not forward accidental empty acceptanceCriteria arrays after starting execution", async () => {
    /* The in-progress branch builds a second patch, so it needs the same safety guard as non-running refinements. */
    const { controller, kanban } = createController();

    await controller.refineTask("task-1", {
      agentId: "opencode-agent",
      sessionId: "session-1",
      status: "in_progress",
      description: "Start execution without wiping the checklist.",
      acceptanceCriteria: []
    });

    expect(kanban.startTaskExecution).toHaveBeenCalledWith({
      taskId: "task-1",
      agentId: "opencode-agent",
      executionSource: "session",
      executionSessionId: "session-1"
    });
    expect(kanban.updateTaskFromExecution).toHaveBeenCalledWith({
      taskId: "task-1",
      actor: {
        agentId: "opencode-agent",
        sessionId: "session-1",
        source: "session"
      },
      patch: {
        description: "Start execution without wiping the checklist."
      }
    });
  });
});
