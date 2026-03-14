/**
 * @fileoverview Tests for kanban task selection, lease recovery, and board links.
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
  status: "backlog" | "queued" | "in_progress" | "blocked" | "done";
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
      ]),
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
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

  test("claimNextTask rejects a second queued claim when the same agent already has active work", async () => {
    /* One agent should keep a single active task so queue claims cannot silently fragment focus. */
    const file = {
      tasks: [
        createTask({
          id: "active-task",
          status: "in_progress",
          claimedBy: "opencode-agent",
          leaseUntil: "2026-03-10T12:00:00.000Z"
        }),
        createTask({
          id: "queued-task",
          status: "queued",
          priority: "high"
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
      ]),
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
    };

    const service = new KanbanService(
      {
        publicBaseUrl: "https://example.test",
        telegramBotToken: "bot-token"
      } as never,
      projects as never,
      store as never
    );

    await expect(
      service.claimNextTask({
        agentId: "opencode-agent",
        projectSlug: "alpha",
        nowMs: Date.parse("2026-03-10T10:00:00.000Z")
      })
    ).rejects.toThrow(
      'Cannot claim the next queued task in project "alpha" because agent "opencode-agent" already has active task "active-task" in progress. Complete or block that task before claiming another one.'
    );
    expect(file.tasks.find((task) => task.id === "queued-task")?.status).toBe("queued");
    expect(file.tasks.find((task) => task.id === "queued-task")?.claimedBy).toBeNull();
  });

  test("completeTask rejects completion while at least one acceptance criterion is still pending", async () => {
    /* Done must remain impossible until every explicit criterion has been verified as complete. */
    const file = {
      tasks: [
        createTask({
          id: "task-pending-criteria",
          status: "in_progress",
          acceptanceCriteria: [
            createCriterion({ id: "criterion-done", status: "done", text: "API implemented" }),
            createCriterion({ id: "criterion-pending", status: "pending", text: "Tests updated" })
          ]
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
      ]),
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
    };

    const service = new KanbanService(
      {
        publicBaseUrl: "https://example.test",
        telegramBotToken: "bot-token"
      } as never,
      projects as never,
      store as never
    );

    await expect(
      service.completeTask({ taskId: "task-pending-criteria", resultSummary: "Done" })
    ).rejects.toThrow("Task cannot be marked done until every acceptance criterion is done");
  });

  test("updateCriterion blocks the whole task when one criterion becomes blocked", async () => {
    /* Any blocked criterion should stop the task so the runner can move on to other queued work safely. */
    const file = {
      tasks: [
        createTask({
          id: "task-with-blocker",
          status: "in_progress",
          acceptanceCriteria: [
            createCriterion({ id: "criterion-open", status: "pending", text: "Need deployment access" })
          ]
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
      ]),
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
    };

    const service = new KanbanService(
      {
        publicBaseUrl: "https://example.test",
        telegramBotToken: "bot-token"
      } as never,
      projects as never,
      store as never
    );

    const updated = await service.updateCriterion({
      taskId: "task-with-blocker",
      criterionId: "criterion-open",
      status: "blocked",
      blockedReason: "Production credentials are missing"
    });

    expect(updated.status).toBe("blocked");
    expect(updated.blockedReason).toBe("Production credentials are missing");
    expect(updated.acceptanceCriteria[0]?.status).toBe("blocked");
    expect(updated.acceptanceCriteria[0]?.blockedReason).toBe("Production credentials are missing");
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
      ]),
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
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

    expect(result.url).toContain("https://example.test/miniapp/?view=kanban&project=alpha#token=");
    expect(result.url).not.toContain("adminId=42");
  });

  test("create, claim, refine, and complete reuse the same stable task id", async () => {
    /* Agent workflows must keep one stable task id across every kanban tool call. */
    const file = {
      tasks: [] as MutableTask[]
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
      ]),
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
    };

    const service = new KanbanService(
      {
        publicBaseUrl: "https://example.test",
        telegramBotToken: "bot-token"
      } as never,
      projects as never,
      store as never
    );

    const created = await service.createTask({
      projectSlug: "alpha",
      title: "Check README",
      description: "Verify docs and code",
      status: "queued",
      priority: "medium",
      acceptanceCriteria: ["README matches code"]
    });

    const claimed = await service.claimNextTask({
      agentId: "opencode-agent",
      projectSlug: "alpha"
    });
    const refined = await service.updateTask(created.id, {
      description: "Verify docs, code, and examples",
      acceptanceCriteria: [
        {
          id: created.acceptanceCriteria[0]?.id,
          text: "README matches code",
          status: "done"
        },
        {
          text: "Examples still work",
          status: "pending"
        }
      ]
    });
    await service.updateCriterion({
      taskId: created.id,
      criterionId: refined.acceptanceCriteria[1]?.id ?? "",
      status: "done"
    });
    const completed = await service.completeTask({ taskId: created.id, resultSummary: "Done" });
    const listed = await service.listTasks({ projectSlug: "alpha" });

    expect(claimed?.id).toBe(created.id);
    expect(refined.id).toBe(created.id);
    expect(completed.id).toBe(created.id);
    expect(listed[0]?.id).toBe(created.id);
    expect(completed.status).toBe("done");
  });

  test("startTaskExecution atomically marks a queued task as session-owned in progress", async () => {
    /* Session-started work needs an explicit owner so runner automation does not launch a duplicate session. */
    const file = {
      tasks: [createTask({ id: "task-session-start", status: "queued" })]
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
      ]),
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
    };

    const service = new KanbanService(
      {
        publicBaseUrl: "https://example.test",
        telegramBotToken: "bot-token"
      } as never,
      projects as never,
      store as never
    );

    const started = await service.startTaskExecution({
      taskId: "task-session-start",
      agentId: "opencode-agent",
      executionSource: "session",
      executionSessionId: "session-alpha",
      nowMs: Date.parse("2026-03-10T10:00:00.000Z")
    });

    expect(started.status).toBe("in_progress");
    expect(started.claimedBy).toBe("opencode-agent");
    expect(started.executionSource).toBe("session");
    expect(started.executionSessionId).toBe("session-alpha");
    expect(started.leaseUntil).toBeTruthy();
  });

  test("startTaskExecution rejects duplicate session start when runner already owns the task", async () => {
    /* Ownership must stay exclusive so session-start and runner-start cannot race into duplicate execution. */
    const file = {
      tasks: [
        createTask({
          id: "task-runner-owned",
          status: "in_progress",
          claimedBy: "kanban-runner",
          leaseUntil: "2026-03-10T12:00:00.000Z",
          executionSource: "runner",
          executionSessionId: "runner-session-1"
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
      ]),
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
    };

    const service = new KanbanService(
      {
        publicBaseUrl: "https://example.test",
        telegramBotToken: "bot-token"
      } as never,
      projects as never,
      store as never
    );

    await expect(
      service.startTaskExecution({
        taskId: "task-runner-owned",
        agentId: "opencode-agent",
        executionSource: "session",
        executionSessionId: "session-alpha",
        nowMs: Date.parse("2026-03-10T10:00:00.000Z")
      })
    ).rejects.toThrow("KANBAN_EXECUTION_OWNERSHIP_CONFLICT");
  });

  test("updateCriterionFromExecution rejects stale session mutations when another session owns the task", async () => {
    /* Once a task is owned by one OpenCode session, a second session must not keep editing its checklist. */
    const file = {
      tasks: [
        createTask({
          id: "task-owned",
          status: "in_progress",
          claimedBy: "opencode-agent",
          acceptanceCriteria: [createCriterion({ id: "criterion-a" })],
          executionSource: "session",
          executionSessionId: "session-owner"
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
      ]),
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
    };

    const service = new KanbanService(
      {
        publicBaseUrl: "https://example.test",
        telegramBotToken: "bot-token"
      } as never,
      projects as never,
      store as never
    );

    await expect(
      service.updateCriterionFromExecution({
        taskId: "task-owned",
        criterionId: "criterion-a",
        status: "done",
        actor: {
          agentId: "opencode-agent",
          sessionId: "session-other",
          source: "session"
        }
      })
    ).rejects.toThrow("KANBAN_EXECUTION_OWNERSHIP_CONFLICT");
  });

  test("updateCriterion re-queues a task after the last blocked criterion is unblocked", async () => {
    /* Unblocking the checklist should not leave the card stuck forever in blocked when no owner remains. */
    const file = {
      tasks: [
        createTask({
          id: "task-blocked",
          status: "blocked",
          blockedReason: "Need review",
          claimedBy: null,
          leaseUntil: null,
          executionSource: null,
          executionSessionId: null,
          acceptanceCriteria: [createCriterion({ id: "criterion-blocked", status: "blocked", blockedReason: "Need review" })]
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
      ]),
      getProjectRootPath: jest.fn(() => "/srv/projects/alpha")
    };

    const service = new KanbanService(
      {
        publicBaseUrl: "https://example.test",
        telegramBotToken: "bot-token"
      } as never,
      projects as never,
      store as never
    );

    const updated = await service.updateCriterion({
      taskId: "task-blocked",
      criterionId: "criterion-blocked",
      status: "done"
    });

    expect(updated.status).toBe("queued");
    expect(updated.blockedReason).toBeNull();
  });
});
