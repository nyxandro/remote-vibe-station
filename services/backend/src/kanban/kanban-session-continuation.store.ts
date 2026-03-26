/**
 * @fileoverview Persistent delivery-backed continuation state for session-owned kanban execution.
 *
 * Exports:
 * - KanbanSessionContinuationEntry - Stored pending continuation barrier state.
 * - KanbanSessionContinuationStore - Reads, writes, and releases pending continuation barriers.
 */

import * as path from "node:path";

import { Injectable } from "@nestjs/common";

import { readJsonFileSync, writeJsonFileSyncAtomic } from "../storage/json-file";

const DATA_DIR = "data";
const FILE_NAME = "kanban.session.continuation.json";

export type KanbanSessionContinuationEntry = {
  adminId: number;
  projectSlug: string;
  taskId: string;
  sessionId: string;
  deliveryGroupId: string;
  pendingItemIds: string[];
  createdAt: string;
};

type ContinuationFile = {
  entries: KanbanSessionContinuationEntry[];
  suppressedSessionIds: string[];
};

@Injectable()
export class KanbanSessionContinuationStore {
  private readonly filePath: string;

  public constructor() {
    /* Persisted continuation barriers must survive backend restarts while Telegram still delivers the final reply. */
    this.filePath = path.join(process.cwd(), DATA_DIR, FILE_NAME);
  }

  public listAll(): KanbanSessionContinuationEntry[] {
    /* Startup reconciliation needs the full outstanding continuation snapshot. */
    return this.readAll().entries;
  }

  public suppressSession(sessionId: string): void {
    /* Manual stops must survive backend restarts so delayed Telegram deliveries cannot revive the same session. */
    const normalized = sessionId.trim();
    if (!normalized) {
      return;
    }

    const file = this.readAll();
    if (!file.suppressedSessionIds.includes(normalized)) {
      file.suppressedSessionIds.push(normalized);
      this.writeAll(file);
    }
  }

  public isSessionSuppressed(sessionId: string): boolean {
    /* Continuation checks stay read-only in the hot path. */
    const normalized = sessionId.trim();
    if (!normalized) {
      return false;
    }

    return this.readAll().suppressedSessionIds.includes(normalized);
  }

  public clearSessionSuppression(sessionId: string): void {
    /* Any new real turn in the same session should re-enable future automatic continuation. */
    const normalized = sessionId.trim();
    if (!normalized) {
      return;
    }

    const file = this.readAll();
    const nextSuppressed = file.suppressedSessionIds.filter((item) => item !== normalized);
    if (nextSuppressed.length === file.suppressedSessionIds.length) {
      return;
    }

    file.suppressedSessionIds = nextSuppressed;
    this.writeAll(file);
  }

  public save(entry: KanbanSessionContinuationEntry): void {
    /* One session should wait on only one delivery-backed continuation barrier at a time. */
    const file = this.readAll();
    file.entries = file.entries.filter((item) => item.sessionId !== entry.sessionId);
    file.entries.push(entry);
    this.writeAll(file);
  }

  public markDelivered(input: { deliveryGroupId: string; itemId: string }): KanbanSessionContinuationEntry | null {
    /* Release the continuation only after every final-reply chunk in the delivery group is confirmed delivered. */
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

  public deleteSession(sessionId: string): void {
    /* Explicit cleanup prevents stale continuation barriers from reviving an old session later. */
    const normalized = sessionId.trim();
    if (!normalized) {
      return;
    }

    const file = this.readAll();
    file.entries = file.entries.filter((entry) => entry.sessionId !== normalized);
    this.writeAll(file);
  }

  private readAll(): ContinuationFile {
    /* Recover malformed state defensively so one bad file never deadlocks session continuation. */
    return readJsonFileSync({
      filePath: this.filePath,
      label: "kanban-session-continuation",
      createEmptyValue: () => ({ entries: [], suppressedSessionIds: [] }),
      normalize: (parsed) => {
        const file = parsed as ContinuationFile | null | undefined;
        return {
          entries: Array.isArray(file?.entries) ? file.entries : [],
          suppressedSessionIds: Array.isArray(file?.suppressedSessionIds)
            ? file.suppressedSessionIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            : []
        };
      },
      parseErrorStrategy: "recover",
      normalizeErrorStrategy: "recover"
    });
  }

  private writeAll(file: ContinuationFile): void {
    /* Keep a stable on-disk snapshot for crash recovery and debugging. */
    writeJsonFileSyncAtomic(this.filePath, file);
  }
}
