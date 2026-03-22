/**
 * @fileoverview Persistent JSON store for kanban tasks.
 *
 * Exports:
 * - KanbanStoreFile - Full JSON payload persisted on disk.
 * - KanbanStore - Serialized read/write access for kanban task records.
 * - KanbanBackupDirToken - Optional override for completion-backup directory.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Inject, Injectable, Optional } from "@nestjs/common";
import { z } from "zod";

import { normalizeStoredCriteria } from "./kanban-criteria";
import { normalizeStoredKanbanStatusTimeline } from "./kanban-task-timeline";
import { KANBAN_PRIORITIES, KANBAN_STATUSES, KanbanTaskRecord } from "./kanban.types";
import { readJsonFileAsync, writeJsonFileAsyncAtomic } from "../storage/json-file";

const DATA_DIR = "data";
const STORE_FILE = "kanban.tasks.json";
const KANBAN_BACKUP_DIR_ENV = "KANBAN_BACKUP_DIR";
const RUNTIME_CONFIG_DIR_ENV = "RUNTIME_CONFIG_DIR";
const BACKUP_DIR_NAME = "backups/kanban";
const BACKUP_FILE_PREFIX = "kanban.tasks.backup-";
const MAX_BACKUP_FILES = 5;

export const KanbanStoreFilePathToken = Symbol("KanbanStoreFilePathToken");
export const KanbanBackupDirToken = Symbol("KanbanBackupDirToken");

const taskSchema = z.object({
  id: z.string().min(1),
  projectSlug: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  status: z.enum(KANBAN_STATUSES),
  priority: z.enum(KANBAN_PRIORITIES),
  acceptanceCriteria: z.array(z.unknown()).transform((value) => normalizeStoredCriteria(value)),
  resultSummary: z.string().nullable(),
  blockedReason: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  claimedBy: z.string().nullable(),
  leaseUntil: z.string().nullable(),
  executionSource: z.enum(["session", "runner"]).nullable().optional(),
  executionSessionId: z.string().nullable().optional(),
  blockedResumeStatus: z.enum(["backlog", "refinement", "ready", "queued", "in_progress", "done"]).nullable().optional(),
  statusTimeline: z.unknown().optional(),
  runnerSessionId: z.string().nullable().optional()
}).transform((value) => ({
  ...value,
  executionSource: value.executionSource ?? (value.runnerSessionId ? "runner" : null),
  executionSessionId: value.executionSessionId ?? value.runnerSessionId ?? null,
  blockedResumeStatus: value.blockedResumeStatus ?? null,
  statusTimeline: normalizeStoredKanbanStatusTimeline({
    storedTimeline: value.statusTimeline,
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  })
}));

const storeSchema = z.object({
  tasks: z.array(taskSchema)
});

export type KanbanStoreFile = {
  tasks: KanbanTaskRecord[];
};

@Injectable()
export class KanbanStore {
  private readonly filePath: string;
  private readonly backupDir: string | null;
  private writeQueue: Promise<void> = Promise.resolve();
  private backupQueue: Promise<void> = Promise.resolve();

  public constructor(
    @Optional() @Inject(KanbanStoreFilePathToken) filePath?: string,
    @Optional() @Inject(KanbanBackupDirToken) backupDir?: string
  ) {
     /* Keep kanban state in backend data volume so board survives container restarts. */
     this.filePath = filePath ?? path.join(process.cwd(), DATA_DIR, STORE_FILE);
     /* Completion backups live outside the data volume so operators can restore tasks after volume loss. */
     this.backupDir = this.resolveBackupDir(backupDir);
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

  public async writeTaskCompletionBackup(): Promise<void> {
    /* Skip backup work when the runtime does not expose an external backup directory. */
    if (!this.backupDir) {
      return;
    }

    const run = async (): Promise<void> => {
      /* Wait for pending writes so the backup always captures the latest committed kanban snapshot. */
      await this.writeQueue;
      const snapshot = await this.readRaw();
      const backupPath = path.join(this.backupDir as string, this.buildBackupFileName());

      /* Create the host-backed backup directory lazily to avoid startup requirements. */
      await fs.mkdir(this.backupDir as string, { recursive: true });
      await writeJsonFileAsyncAtomic(backupPath, snapshot);
      await this.pruneOldBackups();
    };

    const queued = this.backupQueue.then(run, run);
    this.backupQueue = queued.then(
      () => undefined,
      () => undefined
    );
    await queued;
  }

  private async readRaw(): Promise<KanbanStoreFile> {
    /* Kanban state is durable product data, so malformed JSON must fail loudly. */
    return readJsonFileAsync({
      filePath: this.filePath,
      label: "kanban store",
      createEmptyValue: () => ({ tasks: [] }),
      normalize: (parsed) => storeSchema.parse(parsed),
      parseErrorStrategy: "throw",
      normalizeErrorStrategy: "throw"
    });
  }

  private async writeRaw(record: KanbanStoreFile): Promise<void> {
    /* Persist readable JSON so operators can inspect board state directly on the host when needed. */
    await writeJsonFileAsyncAtomic(this.filePath, record);
  }

  private resolveBackupDir(backupDir?: string): string | null {
    /* Prefer an explicit DI override, then env wiring from docker-compose/runtime config. */
    const explicitDir = backupDir?.trim();
    if (explicitDir) {
      return explicitDir;
    }

    const envBackupDir = process.env[KANBAN_BACKUP_DIR_ENV]?.trim();
    if (envBackupDir) {
      return envBackupDir;
    }

    const runtimeConfigDir = process.env[RUNTIME_CONFIG_DIR_ENV]?.trim();
    if (!runtimeConfigDir) {
      return null;
    }

    return path.join(runtimeConfigDir, BACKUP_DIR_NAME);
  }

  private buildBackupFileName(): string {
    /* Keep filenames sortable by time and collision-safe during fast consecutive completions. */
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${BACKUP_FILE_PREFIX}${timestamp}-${crypto.randomUUID()}.json`;
  }

  private async pruneOldBackups(): Promise<void> {
    /* Retain only the newest snapshots so the backup folder stays bounded without manual cleanup. */
    const entries = await fs.readdir(this.backupDir as string, { withFileTypes: true });
    const backupNames = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(BACKUP_FILE_PREFIX) && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();

    const namesToDelete = backupNames.slice(0, Math.max(0, backupNames.length - MAX_BACKUP_FILES));
    await Promise.all(
      namesToDelete.map((name) => fs.rm(path.join(this.backupDir as string, name), { force: true }))
    );
  }
}
