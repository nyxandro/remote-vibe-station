/**
 * @fileoverview Persistent delivery-backed handoff state for kanban runner transitions.
 *
 * Exports:
 * - KanbanRunnerHandoffEntry - Stored pending handoff barrier state.
 * - KanbanRunnerHandoffStore - Reads, writes, and releases pending handoff barriers.
 */

import * as path from "node:path";

import { Injectable } from "@nestjs/common";

import { readJsonFileSync, writeJsonFileSyncAtomic } from "../storage/json-file";

const DATA_DIR = "data";
const FILE_NAME = "kanban.runner.handoff.json";

export type KanbanRunnerHandoffEntry = {
  projectSlug: string;
  taskId: string;
  sessionId: string;
  deliveryGroupId: string;
  pendingItemIds: string[];
  createdAt: string;
};

type HandoffFile = {
  entries: KanbanRunnerHandoffEntry[];
};

@Injectable()
export class KanbanRunnerHandoffStore {
  private readonly filePath: string;

  public constructor() {
    /* Persisted barriers must survive backend restarts while Telegram still delivers the previous final reply. */
    this.filePath = path.join(process.cwd(), DATA_DIR, FILE_NAME);
  }

  public listAll(): KanbanRunnerHandoffEntry[] {
    /* Startup reconciliation needs the full outstanding barrier snapshot. */
    return this.readAll().entries;
  }

  public save(entry: KanbanRunnerHandoffEntry): void {
    /* One project may wait on only one runner handoff at a time. */
    const file = this.readAll();
    file.entries = file.entries.filter((item) => item.projectSlug !== entry.projectSlug);
    file.entries.push(entry);
    this.writeAll(file);
  }

  public markDelivered(input: { deliveryGroupId: string; itemId: string }): KanbanRunnerHandoffEntry | null {
    /* Release the barrier only after every final-reply chunk in the delivery group is confirmed delivered. */
    const file = this.readAll();
    const entry = file.entries.find((item) => item.deliveryGroupId === input.deliveryGroupId) ?? null;
    if (!entry) {
      return null;
    }

    entry.pendingItemIds = entry.pendingItemIds.filter((itemId) => itemId !== input.itemId);
    if (entry.pendingItemIds.length > 0) {
      this.writeAll(file);
      return null;
    }

    file.entries = file.entries.filter((item) => item.deliveryGroupId !== input.deliveryGroupId);
    this.writeAll(file);
    return entry;
  }

  public deleteProject(projectSlug: string): void {
    /* Explicit cleanup prevents stale barriers from blocking future queue pickup for the same project. */
    const file = this.readAll();
    file.entries = file.entries.filter((entry) => entry.projectSlug !== projectSlug);
    this.writeAll(file);
  }

  private readAll(): HandoffFile {
    /* Recover malformed state defensively so one bad file never deadlocks the runner. */
    return readJsonFileSync({
      filePath: this.filePath,
      label: "kanban-runner-handoff",
      createEmptyValue: () => ({ entries: [] }),
      normalize: (parsed) => {
        const file = parsed as HandoffFile | null | undefined;
        return {
          entries: Array.isArray(file?.entries) ? file.entries : []
        };
      },
      parseErrorStrategy: "recover",
      normalizeErrorStrategy: "recover"
    });
  }

  private writeAll(file: HandoffFile): void {
    /* Keep a stable on-disk snapshot for crash recovery and debugging. */
    writeJsonFileSyncAtomic(this.filePath, file);
  }
}
