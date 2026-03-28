/**
 * @fileoverview Regression tests for safe app-side kanban update semantics.
 *
 * Exports:
 * - none (Jest suite).
 */

import { KanbanController } from "../kanban.controller";

const createTask = (overrides?: Record<string, unknown>) => ({
  /* Return a stable task payload so controller tests can assert the outgoing service patch precisely. */
  id: "task-1",
  projectSlug: "alpha",
  projectName: "Alpha",
  title: "Protect checklist",
  description: "Keep acceptance criteria intact while changing task metadata.",
  status: "queued",
  priority: "medium",
  acceptanceCriteria: [{ id: "criterion-1", text: "Criteria survive updates", status: "pending", blockedReason: null }],
  resultSummary: null,
  blockedReason: null,
  createdAt: "2026-03-26T10:00:00.000Z",
  updatedAt: "2026-03-26T10:00:00.000Z",
  claimedBy: null,
  leaseUntil: null,
  executionSource: null,
  executionSessionId: null,
  blockedResumeStatus: null,
  statusTimeline: [{ status: "queued", changedAt: "2026-03-26T10:00:00.000Z" }],
  ...overrides
});

const createController = () => {
  /* Keep collaborators minimal because these tests target updateTask request shaping only. */
  const kanban = {
    updateTask: jest.fn(async (_taskId: string, patch: Record<string, unknown>) => createTask(patch)),
    deleteTask: jest.fn(async (_taskId: string) => createTask())
  };
  const events = {
    publish: jest.fn()
  };
  const config = {
    publicBaseUrl: "https://example.test",
    telegramBotToken: "bot-token"
  };

  return {
    controller: new KanbanController(config as never, kanban as never, events as never),
    kanban,
    events
  };
};

describe("KanbanController updateTask", () => {
  test("ignores accidental empty acceptanceCriteria arrays while still updating task status", async () => {
    /* Browser clients should be able to change status safely even if they send an empty checklist array by mistake. */
    const { controller, kanban } = createController();

    await controller.updateTask("task-1", {
      status: "ready",
      acceptanceCriteria: []
    });

    expect(kanban.updateTask).toHaveBeenCalledWith("task-1", {
      status: "ready"
    });
  });

  test("forwards an explicit checklist clear request only when clearAcceptanceCriteria is true", async () => {
    /* Destructive checklist removal must be explicit for the app endpoint too, matching the agent-safe contract. */
    const { controller, kanban } = createController();

    await controller.updateTask("task-1", {
      status: "ready",
      acceptanceCriteria: [],
      clearAcceptanceCriteria: true
    });

    expect(kanban.updateTask).toHaveBeenCalledWith("task-1", {
      status: "ready",
      acceptanceCriteria: []
    });
  });

  test("treats clearAcceptanceCriteria without an explicit array as an intentional empty checklist", async () => {
    /* The clear flag itself is explicit enough, so browser clients should not need to repeat an empty array. */
    const { controller, kanban } = createController();

    await controller.updateTask("task-1", {
      status: "ready",
      clearAcceptanceCriteria: true
    });

    expect(kanban.updateTask).toHaveBeenCalledWith("task-1", {
      status: "ready",
      acceptanceCriteria: []
    });
  });
});

describe("KanbanController deleteTask", () => {
  test("removes the task and emits a non-runnable kanban mutation event", async () => {
    /* Deletion should refresh subscribed boards without accidentally waking the automation runner for removed work. */
    const { controller, kanban, events } = createController();

    await controller.deleteTask("task-1");

    expect(kanban.deleteTask).toHaveBeenCalledWith("task-1");
    expect(events.publish).toHaveBeenCalledWith({
      type: "kanban.task.updated",
      ts: expect.any(String),
      data: {
        taskId: "task-1",
        taskTitle: "Protect checklist",
        projectSlug: "alpha",
        status: "deleted",
        claimedBy: null,
        executionSource: null,
        source: "app"
      }
    });
  });
});
