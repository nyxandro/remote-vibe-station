/**
 * @fileoverview Tests for kanban JSON persistence store.
 *
 * Exports:
 * - none (Jest suite).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { KanbanStore } from "../kanban.store";

describe("KanbanStore", () => {
  test("transact creates missing store file and persists updated tasks", async () => {
    /* Backend should bootstrap task storage lazily on first kanban mutation. */
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-kanban-store-"));
    const storePath = path.join(tempRoot, "data", "kanban.tasks.json");

    try {
      const store = new KanbanStore(storePath);
      await store.transact((draft) => {
        draft.tasks.push({
          id: "task-1",
          projectSlug: "alpha",
          title: "Implement board",
          description: "",
          status: "backlog",
          priority: "medium",
          acceptanceCriteria: [],
          resultSummary: null,
          blockedReason: null,
          createdAt: "2026-03-10T09:00:00.000Z",
          updatedAt: "2026-03-10T09:00:00.000Z",
          claimedBy: null,
          leaseUntil: null
        });
      });

      const saved = await store.read();
      expect(saved.tasks).toHaveLength(1);
      expect(saved.tasks[0]?.title).toBe("Implement board");
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
