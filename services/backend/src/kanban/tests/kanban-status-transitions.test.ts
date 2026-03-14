/**
 * @fileoverview Regression tests for kanban workflow stages and execution-start gating.
 *
 * Exports:
 * - none (Jest suite).
 */

import { KanbanService } from "../kanban.service";

type MutableCriterion = {
  id: string;
  text: string;
  status: "pending" | "done" | "blocked";
  blockedReason?: string | null;
};

type MutableTask = {
  id: string;
  projectSlug: string;
  title: string;
  description: string;
  status: "backlog" | "refinement" | "ready" | "queued" | "in_progress" | "blocked" | "done";
  priority: "low" | "medium" | "high";
  acceptanceCriteria: MutableCriterion[];
  resultSummary: string | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
  claimedBy: string | null;
  leaseUntil: string | null;
  executionSource: "session" | "runner" | null;
  executionSessionId: string | null;
};

const createCriterion = (overrides?: Partial<MutableCriterion>): MutableCriterion => ({
  id: "criterion-1",
  text: "Criterion",
  status: "pending",
  blockedReason: null,
  ...overrides
});

const createTask = (overrides?: Partial<MutableTask>): MutableTask => ({
  id: "task-1",
  projectSlug: "alpha",
  title: "Prepare kanban flow",
  description: "Clarify the task and move it through the right workflow stages.",
  status: "backlog",
  priority: "medium",
  acceptanceCriteria: [createCriterion({ id: "criterion-a", text: "Definition is explicit" })],
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

const createService = (tasks: MutableTask[]) => {
  /* Each test uses an isolated in-memory store so workflow transitions stay deterministic. */
  const file = { tasks };
  const store = {
    transact: jest.fn(async (operation: (draft: typeof file) => unknown) => operation(file))
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

  return {
    service: new KanbanService(
      {
        publicBaseUrl: "https://example.test",
        telegramBotToken: "bot-token"
      } as never,
      projects as never,
      store as never
    ),
    file
  };
};

describe("Kanban workflow stages", () => {
  test("updateTask rejects jumping directly from backlog to queued", async () => {
    /* Raw backlog ideas must move into refinement first so queue always means intentional execution planning. */
    const { service } = createService([createTask({ status: "backlog" })]);

    await expect(service.updateTask("task-1", { status: "queued" })).rejects.toThrow(
      "KANBAN_STATUS_TRANSITION_NOT_ALLOWED"
    );
  });

  test("updateTask allows refinement to ready and ready to queued", async () => {
    /* Explicit refinement and ready stages should let agents prepare work before placing it into execution queue. */
    const { service } = createService([createTask({ status: "refinement" })]);

    const readyTask = await service.updateTask("task-1", { status: "ready" });
    expect(readyTask.status).toBe("ready");

    const queuedTask = await service.updateTask("task-1", { status: "queued" });
    expect(queuedTask.status).toBe("queued");
  });

  test("startTaskExecution rejects starting directly from ready without queueing first", async () => {
    /* Execution ownership begins only from queued tasks so ready remains a non-running staging column. */
    const { service } = createService([createTask({ status: "ready" })]);

    await expect(
      service.startTaskExecution({
        taskId: "task-1",
        agentId: "opencode-agent",
        executionSource: "session",
        executionSessionId: "session-ready"
      })
    ).rejects.toThrow("KANBAN_TASK_NOT_QUEUED_FOR_EXECUTION");
  });

  test("startTaskExecution accepts a queued task after it passes through ready", async () => {
    /* Prepared tasks should become executable once they are intentionally queued. */
    const { service } = createService([createTask({ status: "queued" })]);

    const started = await service.startTaskExecution({
      taskId: "task-1",
      agentId: "opencode-agent",
      executionSource: "session",
      executionSessionId: "session-queued"
    });

    expect(started.status).toBe("in_progress");
    expect(started.executionSource).toBe("session");
    expect(started.executionSessionId).toBe("session-queued");
  });
});
