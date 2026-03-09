/**
 * @fileoverview Tests for kanban task selection, lease recovery, and board links.
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
  acceptanceCriteria: string[];
  resultSummary: string | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
  claimedBy: string | null;
  leaseUntil: string | null;
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
  ...overrides
});

describe("KanbanService", () => {
  test("claimNextTask resolves project by current directory and claims highest priority queued task", async () => {
    /* Agent should pick the top queued task from the current project instead of another project. */
    const file = {
      tasks: [
        createTask({ id: "alpha-low", projectSlug: "alpha", priority: "low" }),
        createTask({ id: "alpha-high", projectSlug: "alpha", priority: "high" }),
        createTask({ id: "beta-high", projectSlug: "beta", priority: "high" })
      ]
    };

    const store = {
      transact: jest.fn(async (operation: (draft: typeof file) => unknown) => operation(file))
    };
    const projects = {
      list: jest.fn(async () => [
        {
          id: "alpha",
          slug: "alpha",
          name: "alpha",
          rootPath: "/srv/projects/alpha",
          hasCompose: true,
          configured: true,
          runnable: true,
          status: "running"
        },
        {
          id: "beta",
          slug: "beta",
          name: "beta",
          rootPath: "/srv/projects/beta",
          hasCompose: true,
          configured: true,
          runnable: true,
          status: "running"
        }
      ])
    };

    const service = new KanbanService(
      {
        publicBaseUrl: "https://example.test",
        telegramBotToken: "bot-token"
      } as never,
      projects as never,
      store as never
    );

    const claimed = await service.claimNextTask({
      agentId: "opencode-agent",
      currentDirectory: "/srv/projects/alpha/apps/web"
    });

    expect(claimed?.id).toBe("alpha-high");
    expect(claimed?.status).toBe("in_progress");
    expect(claimed?.claimedBy).toBe("opencode-agent");
    expect(claimed?.leaseUntil).toBeTruthy();
    expect(file.tasks.find((task) => task.id === "alpha-high")?.status).toBe("in_progress");
    expect(file.tasks.find((task) => task.id === "beta-high")?.status).toBe("queued");
  });

  test("listTasks releases expired in-progress leases back to queued", async () => {
    /* Stale agent claims must not block the board forever when a worker disappears. */
    const file = {
      tasks: [
        createTask({
          id: "expired",
          status: "in_progress",
          claimedBy: "opencode-agent",
          leaseUntil: "2026-03-10T08:00:00.000Z"
        })
      ]
    };

    const store = {
      transact: jest.fn(async (operation: (draft: typeof file) => unknown) => operation(file))
    };
    const projects = {
      list: jest.fn(async () => [
        {
          id: "alpha",
          slug: "alpha",
          name: "alpha",
          rootPath: "/srv/projects/alpha",
          hasCompose: true,
          configured: true,
          runnable: true,
          status: "running"
        }
      ])
    };

    const service = new KanbanService(
      {
        publicBaseUrl: "https://example.test",
        telegramBotToken: "bot-token"
      } as never,
      projects as never,
      store as never
    );

    const tasks = await service.listTasks({
      projectSlug: "alpha",
      nowMs: Date.parse("2026-03-10T10:00:00.000Z")
    });

    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.status).toBe("queued");
    expect(tasks[0]?.claimedBy).toBeNull();
    expect(tasks[0]?.leaseUntil).toBeNull();
    expect(file.tasks[0]?.status).toBe("queued");
  });

  test("createBoardLink returns secure standalone kanban URL with optional project filter", async () => {
    /* Shared board links must open the standalone board view without exposing raw admin ids. */
    const service = new KanbanService(
      {
        publicBaseUrl: "https://example.test",
        telegramBotToken: "bot-token"
      } as never,
      { list: jest.fn(async () => []) } as never,
      { transact: jest.fn() } as never
    );

    const result = await service.createBoardLink({ adminId: 42, projectSlug: "alpha", nowMs: 1 });

    expect(result.url).toContain("https://example.test/miniapp?view=kanban&project=alpha#token=");
    expect(result.url).not.toContain("adminId=42");
  });
});
