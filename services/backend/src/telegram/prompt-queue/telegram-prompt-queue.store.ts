/**
 * @fileoverview JSON-backed store for Telegram prompt buffers and queued items.
 *
 * Exports:
 * - TelegramPromptQueueStore - Persists debounce buffers and sequential queue state.
 */

import * as crypto from "node:crypto";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";

import {
  TelegramBufferedAttachment,
  TelegramPromptBuffer,
  TelegramPromptQueueFile,
  TelegramPromptQueueItem,
  TelegramQueuedAttachment
} from "./telegram-prompt-queue.types";
import { readJsonFileSync, writeJsonFileSyncAtomic } from "../../storage/json-file";

const DATA_DIR = "data";
const STORE_FILE = "telegram.prompt-queue.json";
const MAX_TERMINAL_ITEMS_TO_KEEP = 200;

@Injectable()
export class TelegramPromptQueueStore {
  private readonly filePath: string;

  public constructor() {
    /* Persist queue state in backend data volume so restarts do not lose messages. */
    this.filePath = path.join(process.cwd(), DATA_DIR, STORE_FILE);
  }

  public appendBuffer(input: {
    key: string;
    adminId: number;
    chatId: number;
    directory: string;
    projectSlug: string;
    text?: string | null;
    attachments?: TelegramBufferedAttachment[];
    messageId?: number | null;
    nowIso: string;
    flushAtIso: string;
  }): TelegramPromptBuffer {
    /* Keep one mutable debounce buffer per admin+project key. */
    const file = this.readAll();
    const existing = file.buffers.find((buffer) => buffer.key === input.key);
    const normalizedText = typeof input.text === "string" ? input.text.trim() : "";
    const attachments = Array.isArray(input.attachments) ? input.attachments : [];

    if (existing) {
      /* Extend the same logical prompt while new chunks keep arriving inside debounce window. */
      existing.chatId = input.chatId;
      existing.updatedAt = input.nowIso;
      existing.flushAt = input.flushAtIso;

      if (normalizedText.length > 0) {
        existing.textSegments.push(normalizedText);
      }

      for (const attachment of attachments) {
        existing.attachments.push(attachment);
      }

      if (typeof input.messageId === "number" && !existing.sourceMessageIds.includes(input.messageId)) {
        existing.sourceMessageIds.push(input.messageId);
      }

      this.writeAll(file);
      return existing;
    }

    /* Create a fresh buffer for the first chunk in a new logical prompt. */
    const next: TelegramPromptBuffer = {
      id: crypto.randomUUID(),
      key: input.key,
      adminId: input.adminId,
      chatId: input.chatId,
      directory: input.directory,
      projectSlug: input.projectSlug,
      textSegments: normalizedText.length > 0 ? [normalizedText] : [],
      attachments: [...attachments],
      sourceMessageIds: typeof input.messageId === "number" ? [input.messageId] : [],
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
      flushAt: input.flushAtIso
    };

    file.buffers.push(next);
    this.writeAll(file);
    return next;
  }

  public getBuffer(key: string): TelegramPromptBuffer | null {
    /* Read current buffer snapshot without mutating state. */
    const file = this.readAll();
    return file.buffers.find((buffer) => buffer.key === key) ?? null;
  }

  public listBuffers(): TelegramPromptBuffer[] {
    /* Service startup uses this to restore timers after restart. */
    return this.readAll().buffers;
  }

  public removeBuffer(key: string): void {
    /* Drop flushed or invalid buffer once it is no longer needed. */
    const file = this.readAll();
    file.buffers = file.buffers.filter((buffer) => buffer.key !== key);
    this.writeAll(file);
  }

  public enqueueItem(input: {
    key: string;
    adminId: number;
    chatId: number;
    directory: string;
    projectSlug: string;
    text: string;
    attachments: TelegramQueuedAttachment[];
    sourceMessageIds: number[];
    createdAtIso: string;
  }): TelegramPromptQueueItem {
    /* Append a new ready-to-dispatch prompt item. */
    const file = this.readAll();
    const item: TelegramPromptQueueItem = {
      id: crypto.randomUUID(),
      key: input.key,
      adminId: input.adminId,
      chatId: input.chatId,
      directory: input.directory,
      projectSlug: input.projectSlug,
      text: input.text,
      attachments: input.attachments,
      sourceMessageIds: [...input.sourceMessageIds],
      createdAt: input.createdAtIso,
      status: "pending"
    };

    file.items.push(item);
    this.writeAll(file);
    return item;
  }

  public countOutstandingItems(key: string): number {
    /* Queue depth is used for operational acknowledgements. */
    const file = this.readAll();
    return file.items.filter((item) => item.key === key && (item.status === "pending" || item.status === "running")).length;
  }

  public listQueueKeys(): string[] {
    /* Startup recovery pumps each project queue independently. */
    const file = this.readAll();
    return [...new Set(file.items.map((item) => item.key))];
  }

  public requeueRunningItems(nowIso: string): void {
    /* Recover in-flight items after backend restart so they can be retried safely. */
    const file = this.readAll();

    for (const item of file.items) {
      if (item.status !== "running") {
        continue;
      }

      item.status = "pending";
      item.startedAt = undefined;
      item.error = undefined;
      item.failedAt = undefined;
      item.createdAt = item.createdAt || nowIso;
    }

    this.writeAll(file);
  }

  public claimNextPendingItem(key: string, startedAtIso: string): TelegramPromptQueueItem | null {
    /* Mark the oldest pending item as running to enforce one active dispatch per key. */
    const file = this.readAll();
    const item = file.items.find((candidate) => candidate.key === key && candidate.status === "pending");
    if (!item) {
      return null;
    }

    item.status = "running";
    item.startedAt = startedAtIso;
    this.writeAll(file);
    return item;
  }

  public markCompleted(itemId: string, completedAtIso: string): void {
    /* Finalize successful dispatch and keep compact history for debugging. */
    const file = this.readAll();
    const item = file.items.find((candidate) => candidate.id === itemId);
    if (!item) {
      return;
    }

    item.status = "completed";
    item.completedAt = completedAtIso;
    item.error = undefined;
    this.pruneTerminalItems(file);
    this.writeAll(file);
  }

  public markFailed(itemId: string, failedAtIso: string, error: string): void {
    /* Failed prompts should not block the queue, but error context must stay visible. */
    const file = this.readAll();
    const item = file.items.find((candidate) => candidate.id === itemId);
    if (!item) {
      return;
    }

    item.status = "failed";
    item.failedAt = failedAtIso;
    item.error = error.slice(0, 500);
    this.pruneTerminalItems(file);
    this.writeAll(file);
  }

  private pruneTerminalItems(file: TelegramPromptQueueFile): void {
    /* Keep recent terminal history for debugging without growing the JSON store forever. */
    const activeItems = file.items.filter((item) => item.status === "pending" || item.status === "running");
    const terminalItems = file.items
      .filter((item) => item.status === "completed" || item.status === "failed")
      .sort((left, right) => this.resolveTerminalTimestamp(right) - this.resolveTerminalTimestamp(left))
      .slice(0, MAX_TERMINAL_ITEMS_TO_KEEP);

    file.items = [...activeItems, ...terminalItems].sort((left, right) => {
      return Date.parse(left.createdAt) - Date.parse(right.createdAt);
    });
  }

  private resolveTerminalTimestamp(item: TelegramPromptQueueItem): number {
    /* Sort completed/failed items by their terminal timestamp and fallback to creation time. */
    const terminalAt = item.status === "completed" ? item.completedAt : item.failedAt;
    return Date.parse(terminalAt ?? item.createdAt) || 0;
  }

  private readAll(): TelegramPromptQueueFile {
    /* Missing or broken files should not block the runtime queue after backend restart. */
    return readJsonFileSync({
      filePath: this.filePath,
      label: "telegram-prompt-queue",
      createEmptyValue: () => ({ buffers: [], items: [] }),
      normalize: (parsed) => {
        const file = parsed as TelegramPromptQueueFile | null | undefined;
        return {
          buffers: Array.isArray(file?.buffers) ? file.buffers : [],
          items: Array.isArray(file?.items) ? file.items : []
        };
      },
      parseErrorStrategy: "recover",
      normalizeErrorStrategy: "recover"
    });
  }

  private writeAll(file: TelegramPromptQueueFile): void {
    /* Pretty JSON keeps manual debugging straightforward in mounted data volume. */
    writeJsonFileSyncAtomic(this.filePath, file);
  }
}
