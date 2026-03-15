/**
 * @fileoverview Tests for kanban completion backup triggering.
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
  status: "queued" | "in_progress" | "done";
  priority: "low" | "medium" | "high";
  acceptanceCriteria: Array<{
    id: string;
    text: string;
    status: "pending" | "done" | "blocked";
    blockedReason?: string | null;
  }>;
  resultSummary: string | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
  claimedBy: string | null;
  leaseUntil: string | null;
  executionSource: "session" | "runner" | null;
  executionSessionId: string | null;
};

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

const createTask = (): MutableTask => ({
  id: "task-1",
  projectSlug: "alpha",
  title: "Ship backup",
  description: "",
  status: "in_progress",
  priority: "medium",
  acceptanceCriteria: [{ id: "criterion-1", text: "Done", status: "done", blockedReason: null }],
  resultSummary: null,
  blockedReason: null,
  createdAt: "2026-03-10T09:00:00.000Z",
  updatedAt: "2026-03-10T09:00:00.000Z",
  claimedBy: "opencode-agent",
  leaseUntil: "2026-03-10T12:00:00.000Z",
  executionSource: "session",
  executionSessionId: "session-1"
});

describe("KanbanService completion backups", () => {
  test("completeTask writes an external backup after marking the task done", async () => {
    /* Manual completion should update the card and then snapshot the board for recovery. */
    const file = { tasks: [createTask()] };
    const store = {
      transact: jest.fn(async (operation: (draft: typeof file) => unknown) => operation(file)),
      writeTaskCompletionBackup: jest.fn(async () => undefined)
    };
    const service = new KanbanService(
      {
        publicBaseUrl: "https://example.test",
        telegramBotToken: "bot-token"
      } as never,
      createProjects() as never,
      store as never
    );

    const completed = await service.completeTask({ taskId: "task-1", resultSummary: "Done" });

    expect(completed.status).toBe("done");
    expect(store.writeTaskCompletionBackup).toHaveBeenCalledTimes(1);
  });

  test("completeTaskFromExecution writes the same backup after owned execution completes", async () => {
    /* Runner/session completion path should not skip the disaster-recovery snapshot. */
    const file = { tasks: [createTask()] };
    const store = {
      transact: jest.fn(async (operation: (draft: typeof file) => unknown) => operation(file)),
      writeTaskCompletionBackup: jest.fn(async () => undefined)
    };
    const service = new KanbanService(
      {
        publicBaseUrl: "https://example.test",
        telegramBotToken: "bot-token"
      } as never,
      createProjects() as never,
      store as never
    );

    const completed = await service.completeTaskFromExecution({
      taskId: "task-1",
      resultSummary: "Done",
      actor: {
        agentId: "opencode-agent",
        sessionId: "session-1",
        source: "session"
      }
    });

    expect(completed.status).toBe("done");
    expect(store.writeTaskCompletionBackup).toHaveBeenCalledTimes(1);
  });
});
