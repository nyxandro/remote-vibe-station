/**
 * @fileoverview Tests for user-facing kanban task deletion rules.
 *
 * Exports:
 * - none (Jest suite).
 */

import { KanbanService } from "../kanban.service";

type MutableTask = {
  id: string;
  projectSlug: string;
  title: string;
  description: string;
  status: "backlog" | "queued" | "in_progress" | "blocked" | "done";
  priority: "low" | "medium" | "high";
  acceptanceCriteria: Array<{ id: string; text: string; status: "pending" | "done" | "blocked"; blockedReason?: string | null }>;
  resultSummary: string | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
  claimedBy: string | null;
  leaseUntil: string | null;
  executionSource: "session" | "runner" | null;
  executionSessionId: string | null;
  blockedResumeStatus?: "backlog" | "refinement" | "ready" | "queued" | "in_progress" | "done" | null;
};

const createTask = (overrides?: Partial<MutableTask>): MutableTask => ({
  id: "task-1",
  projectSlug: "alpha",
  title: "Task",
  description: "",
  status: "queued",
  priority: "medium",
  acceptanceCriteria: [],
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

const createProjects = () => ({
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
});

describe("KanbanService deletion", () => {
  test("deleteTask removes the card from the store and returns its last snapshot", async () => {
    /* User-driven deletion should fully remove stale work while still exposing enough metadata for live UI invalidation. */
    const file = {
      tasks: [
        createTask({ id: "task-delete", title: "Delete me", status: "blocked", claimedBy: "opencode-agent" }),
        createTask({ id: "task-keep", title: "Keep me", status: "queued" })
      ]
    };
    const store = {
      transact: jest.fn(async (operation: (draft: typeof file) => unknown) => operation(file))
    };
    const service = new KanbanService(
      {
        publicBaseUrl: "https://example.test",
        telegramBotToken: "bot-token"
      } as never,
      createProjects() as never,
      store as never
    );

    const deleted = await service.deleteTask("task-delete");

    expect(deleted).toMatchObject({
      id: "task-delete",
      title: "Delete me",
      status: "blocked",
      projectSlug: "alpha",
      projectName: "Alpha"
    });
    expect(file.tasks.map((task) => task.id)).toEqual(["task-keep"]);
  });

  test("deleteTask rejects deletion while the task is actively in progress", async () => {
    /* User cleanup should not invalidate a live agent session that still owns the current task. */
    const file = {
      tasks: [
        createTask({
          id: "task-running",
          status: "in_progress",
          claimedBy: "opencode-agent",
          leaseUntil: "2026-03-10T12:00:00.000Z",
          executionSource: "session",
          executionSessionId: "session-alpha"
        })
      ]
    };
    const store = {
      transact: jest.fn(async (operation: (draft: typeof file) => unknown) => operation(file))
    };
    const service = new KanbanService(
      {
        publicBaseUrl: "https://example.test",
        telegramBotToken: "bot-token"
      } as never,
      createProjects() as never,
      store as never
    );

    await expect(service.deleteTask("task-running")).rejects.toThrow(
      'Cannot delete kanban task "task-running" while it is in progress. Block or finish it first.'
    );
    expect(file.tasks).toHaveLength(1);
  });
});
