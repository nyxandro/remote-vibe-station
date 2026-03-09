/**
 * @fileoverview Persistent JSON store for kanban tasks.
 *
 * Exports:
 * - KanbanStoreFile - Full JSON payload persisted on disk.
 * - KanbanStore - Serialized read/write access for kanban task records.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Inject, Injectable, Optional } from "@nestjs/common";
import { z } from "zod";

import { KANBAN_PRIORITIES, KANBAN_STATUSES, KanbanTaskRecord } from "./kanban.types";

const DATA_DIR = "data";
const STORE_FILE = "kanban.tasks.json";

export const KanbanStoreFilePathToken = Symbol("KanbanStoreFilePathToken");

const taskSchema = z.object({
  id: z.string().min(1),
  projectSlug: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  status: z.enum(KANBAN_STATUSES),
  priority: z.enum(KANBAN_PRIORITIES),
  acceptanceCriteria: z.array(z.string()),
  resultSummary: z.string().nullable(),
  blockedReason: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  claimedBy: z.string().nullable(),
  leaseUntil: z.string().nullable()
});

const storeSchema = z.object({
  tasks: z.array(taskSchema)
});

export type KanbanStoreFile = {
  tasks: KanbanTaskRecord[];
};

@Injectable()
export class KanbanStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(
    @Optional() @Inject(KanbanStoreFilePathToken) filePath?: string
  ) {
    /* Keep kanban state in backend data volume so board survives container restarts. */
    this.filePath = filePath ?? path.join(process.cwd(), DATA_DIR, STORE_FILE);
  }

  public async read(): Promise<KanbanStoreFile> {
    /* Wait for pending writes to preserve read-after-write consistency for the UI and agents. */
    await this.writeQueue;
    return this.readRaw();
  }

  public async transact<T>(
    operation: (draft: KanbanStoreFile) => T | Promise<T>
  ): Promise<T> {
    /* Serialize read-modify-write transactions so multiple agents cannot clobber the same JSON file. */
    let result: T | undefined;

    const run = async (): Promise<void> => {
      const draft = await this.readRaw();
      result = await operation(draft);
      await this.writeRaw(draft);
    };

    const queued = this.writeQueue.then(run, run);
    this.writeQueue = queued.then(
      () => undefined,
      () => undefined
    );
    await queued;
    return result as T;
  }

  private async readRaw(): Promise<KanbanStoreFile> {
    /* Create parent directory lazily because the board may be unused on fresh installations. */
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });

    let raw: string;
    try {
      raw = await fs.promises.readFile(this.filePath, "utf-8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { tasks: [] };
      }
      throw error;
    }

    try {
      return storeSchema.parse(JSON.parse(raw));
    } catch (error) {
      throw new Error(`Failed to parse kanban store JSON at '${this.filePath}': ${String(error)}`);
    }
  }

  private async writeRaw(record: KanbanStoreFile): Promise<void> {
    /* Persist readable JSON so operators can inspect board state directly on the host when needed. */
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.promises.writeFile(this.filePath, JSON.stringify(record, null, 2), "utf-8");
  }
}
