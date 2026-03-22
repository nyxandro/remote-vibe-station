/**
 * @fileoverview Tests for compact kanban status-timeline persistence.
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

type MutableStatusTimelineEntry = {
  status: "backlog" | "refinement" | "ready" | "queued" | "in_progress" | "blocked" | "done";
  changedAt: string;
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
  blockedResumeStatus?: "backlog" | "refinement" | "ready" | "queued" | "in_progress" | "done" | null;
  statusTimeline?: MutableStatusTimelineEntry[];
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
  title: "Track execution time",
  description: "Persist only status transitions needed for execution timing.",
  status: "queued",
  priority: "medium",
  acceptanceCriteria: [createCriterion({ id: "criterion-done", status: "done" })],
  resultSummary: null,
  blockedReason: null,
  createdAt: "2026-03-22T09:00:00.000Z",
  updatedAt: "2026-03-22T09:00:00.000Z",
  claimedBy: null,
  leaseUntil: null,
  executionSource: null,
  executionSessionId: null,
  ...overrides
});

const createService = (tasks: MutableTask[]) => {
  /* Each test uses an isolated in-memory store so timeline transitions stay deterministic. */
  const file = { tasks };
  const store = {
    transact: jest.fn(async (operation: (draft: typeof file) => unknown) => operation(file)),
    writeTaskCompletionBackup: jest.fn(async () => undefined)
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
    file,
    store
  };
};

describe("Kanban task status timeline", () => {
  beforeEach(() => {
    /* Fake time makes transition timestamps deterministic across create/claim/block/complete flows. */
    jest.useFakeTimers();
  });

  afterEach(() => {
    /* Restore real timers so kanban timing tests cannot leak into unrelated suites. */
    jest.useRealTimers();
  });

  test("creates a compact initial timeline entry for new tasks", async () => {
    /* New tasks should store only the current workflow stage and timestamp, not a verbose audit trail. */
    jest.setSystemTime(new Date("2026-03-22T09:00:00.000Z"));
    const { service, file } = createService([]);

    await service.createTask({
      projectSlug: "alpha",
      title: "Prepare rollout",
      description: "Track stage timing from the start.",
      status: "ready",
      priority: "high",
      acceptanceCriteria: []
    });

    expect(file.tasks[0]?.statusTimeline).toEqual([
      {
        status: "ready",
        changedAt: "2026-03-22T09:00:00.000Z"
      }
    ]);
  });

  test("records only real status changes across blocked reruns and completion", async () => {
    /* Execution timing should survive retries while storing only stage transitions needed for the UI timeline. */
    const { service, file } = createService([
      createTask({
        id: "task-rerun",
        acceptanceCriteria: [createCriterion({ id: "criterion-final", status: "done" })],
        statusTimeline: [{ status: "queued", changedAt: "2026-03-22T09:00:00.000Z" }]
      })
    ]);

    jest.setSystemTime(new Date("2026-03-22T09:05:00.000Z"));
    await service.startTaskExecution({
      taskId: "task-rerun",
      agentId: "runner-1",
      executionSource: "session",
      executionSessionId: "session-1"
    });

    jest.setSystemTime(new Date("2026-03-22T09:20:00.000Z"));
    await service.blockTask({ taskId: "task-rerun", reason: "Need API access" });

    jest.setSystemTime(new Date("2026-03-22T09:25:00.000Z"));
    await service.updateTask("task-rerun", { blockedReason: "Still waiting on API access" });

    jest.setSystemTime(new Date("2026-03-22T09:40:00.000Z"));
    await service.updateTask("task-rerun", { status: "queued" });

    jest.setSystemTime(new Date("2026-03-22T09:50:00.000Z"));
    await service.startTaskExecution({
      taskId: "task-rerun",
      agentId: "runner-1",
      executionSource: "session",
      executionSessionId: "session-2"
    });

    jest.setSystemTime(new Date("2026-03-22T10:10:00.000Z"));
    await service.completeTask({ taskId: "task-rerun", resultSummary: "Finished after rerun" });

    expect(file.tasks[0]?.statusTimeline).toEqual([
      { status: "queued", changedAt: "2026-03-22T09:00:00.000Z" },
      { status: "in_progress", changedAt: "2026-03-22T09:05:00.000Z" },
      { status: "blocked", changedAt: "2026-03-22T09:20:00.000Z" },
      { status: "queued", changedAt: "2026-03-22T09:40:00.000Z" },
      { status: "in_progress", changedAt: "2026-03-22T09:50:00.000Z" },
      { status: "done", changedAt: "2026-03-22T10:10:00.000Z" }
    ]);
  });
});
