/**
 * @fileoverview Persistent outbox for reliable Telegram delivery.
 *
 * Why:
 * - Telegram Bot API calls can fail due to transient network issues.
 * - Bot process can restart; we must not lose assistant replies.
 * - Backend has a mounted `./data` volume in docker-compose; store lives there.
 *
 * Exports:
 * - TelegramOutboxStore - Append/pull/report operations with leasing.
 */

import * as crypto from "node:crypto";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";

import {
  OUTBOX_LEASE_MS,
  OUTBOX_MAX_ATTEMPTS,
  OutboxPullItem,
  OutboxReportResult,
  TelegramOutboxItem
} from "./telegram-outbox.types";
import { readJsonFileSync, writeJsonFileSyncAtomic } from "../../storage/json-file";

const DATA_DIR = "data";
const FILE_NAME = "telegram.outbox.json";

/*
 * Retention defaults are intentionally conservative.
 * - Delivered messages are useful for debugging, but should not grow unbounded.
 * - Dead messages are kept longer for post-mortem, but are pruned by age and count.
 */
const DEFAULT_MAX_DELIVERED_TO_KEEP = 500;
const DEFAULT_MAX_DEAD_TO_KEEP = 500;
const DEFAULT_MAX_DEAD_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PLAIN_MESSAGE_DEDUP_WINDOW_MS = 5_000;

type OutboxFile = {
  items: TelegramOutboxItem[];
};

const nowIso = (): string => new Date().toISOString();

const parseIso = (value?: string): number => {
  /* Treat invalid timestamps as 0 to avoid hiding messages. */
  if (!value) {
    return 0;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
};

const computeBackoffMs = (attempts: number): number => {
  /*
   * Exponential backoff with a ceiling.
   * Attempts starts at 1 on first failure.
   */
  const baseMs = 1_000;
  const maxMs = 5 * 60_000;
  const exp = Math.min(attempts, 10);
  const candidate = baseMs * Math.pow(2, exp);
  return Math.min(candidate, maxMs);
};

const areInlineKeyboardsEqual = (
  left?: { inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> },
  right?: { inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> }
): boolean => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

@Injectable()
export class TelegramOutboxStore {
  private readonly filePath: string;

  public constructor() {
    /* Persist in backend data volume; safe across restarts. */
    this.filePath = path.join(process.cwd(), DATA_DIR, FILE_NAME);
  }

  public enqueue(input: {
    adminId: number;
    chatId: number;
    text: string;
    parseMode?: "HTML";
    disableNotification?: boolean;
    nowMs?: number;
      mode?: "send" | "replace";
    progressKey?: string;
    control?: {
      kind: "thinking";
      action: "start" | "stop";
    };
    replyMarkup?: {
      inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>;
    };
  }): TelegramOutboxItem {
    /* Append a pending item with immediate availability. */
    const nowMs = input.nowMs ?? Date.now();
    const now = new Date(nowMs).toISOString();
    const file = this.readAll();

    /* Collapse accidental duplicate plain messages caused by repeated event delivery in the same short burst. */
    if (!input.control && !input.progressKey && (input.mode === undefined || input.mode === "send") && input.text.trim()) {
      const existing = this.findRecentPlainDuplicate({
        items: file.items,
        input,
        nowMs
      });
      if (existing) {
        return existing;
      }
    }

    /* Coalesce pending live-progress snapshots so Telegram stream follows the newest text only. */
    if (input.mode === "replace" && input.progressKey) {
      const existing = file.items.find(
        (item) =>
          item.status === "pending" &&
          item.adminId === input.adminId &&
          item.chatId === input.chatId &&
          item.mode === input.mode &&
          item.progressKey === input.progressKey
      );

      if (existing) {
        const existingLeaseMs = parseIso(existing.inFlightUntil);
        const existingInFlight = existingLeaseMs > nowMs;

        /* Once a worker already pulled the old snapshot, preserve that id and queue a fresh pending update separately. */
        if (!existingInFlight) {
          existing.text = input.text;
          existing.parseMode = input.parseMode;
          existing.disableNotification = input.disableNotification;
          existing.control = input.control;
          existing.replyMarkup = input.replyMarkup;
          existing.inFlightBy = undefined;
          existing.inFlightUntil = undefined;
          existing.nextAttemptAt = now;

          /* Drop older duplicate pending snapshots for the same live progress slot. */
          file.items = file.items.filter(
            (item) =>
              item.id === existing.id ||
              item.status !== "pending" ||
              item.adminId !== input.adminId ||
              item.chatId !== input.chatId ||
              item.mode !== input.mode ||
              item.progressKey !== input.progressKey ||
              parseIso(item.inFlightUntil) > nowMs
          );

          this.writeAll(file);
          return existing;
        }
      }
    }

    const item: TelegramOutboxItem = {
      id: crypto.randomUUID(),
      adminId: input.adminId,
      chatId: input.chatId,
      text: input.text,
      parseMode: input.parseMode,
      disableNotification: input.disableNotification,
      mode: input.mode,
      progressKey: input.progressKey,
      control: input.control,
      replyMarkup: input.replyMarkup,
      createdAt: now,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now
    };

    file.items.push(item);
    this.writeAll(file);
    return item;
  }

  public pull(input: { adminId: number; limit: number; workerId: string; nowMs?: number }): OutboxPullItem[] {
    /*
     * Return due pending messages for an admin and lease them.
     * Lease prevents duplicates if multiple workers poll.
     */
    const nowMs = input.nowMs ?? Date.now();
    const file = this.readAll();
    const due: TelegramOutboxItem[] = [];

    for (const item of file.items) {
      if (item.status !== "pending") {
        continue;
      }
      if (item.adminId !== input.adminId) {
        continue;
      }

      const nextAttemptMs = parseIso(item.nextAttemptAt);
      if (nextAttemptMs > nowMs) {
        continue;
      }

      const inFlightUntilMs = parseIso(item.inFlightUntil);
      if (inFlightUntilMs > nowMs) {
        continue;
      }

      due.push(item);
      if (due.length >= input.limit) {
        break;
      }
    }

    if (due.length === 0) {
      return [];
    }

    const leaseUntil = new Date(nowMs + OUTBOX_LEASE_MS).toISOString();
    for (const item of due) {
      item.inFlightUntil = leaseUntil;
      item.inFlightBy = input.workerId;
    }

    this.writeAll(file);
    return due.map((item) => ({
      id: item.id,
      chatId: item.chatId,
      text: item.text,
      parseMode: item.parseMode,
      disableNotification: item.disableNotification,
      mode: item.mode,
      progressKey: item.progressKey,
      control: item.control,
      replyMarkup: item.replyMarkup
    }));
  }

  public report(input: { adminId: number; workerId: string; results: OutboxReportResult[]; nowMs?: number }): void {
    /* Update delivery state based on bot reports. */
    const nowMs = input.nowMs ?? Date.now();
    const nowIsoFromNowMs = new Date(nowMs).toISOString();
    const file = this.readAll();
    const byId = new Map(file.items.map((item) => [item.id, item] as const));

    for (const result of input.results) {
      const item = byId.get(result.id);
      if (!item) {
        continue;
      }
      if (item.adminId !== input.adminId) {
        continue;
      }
      if (item.status !== "pending") {
        continue;
      }

      /* Only accept report from the leasing worker (best-effort). */
      if (item.inFlightBy && item.inFlightBy !== input.workerId) {
        continue;
      }

      if (result.ok) {
        item.status = "delivered";
        /* Use injected nowMs for deterministic testing. */
        item.deliveredAt = nowIsoFromNowMs;
        if (typeof result.telegramMessageId === "number") {
          item.telegramMessageId = result.telegramMessageId;
        }
        item.inFlightBy = undefined;
        item.inFlightUntil = undefined;
        continue;
      }

      /* Failure path: schedule retry with bounded exponential backoff. */
      item.attempts += 1;
      item.lastError = (result.error ?? "Delivery failed").slice(0, 500);

      item.inFlightBy = undefined;
      item.inFlightUntil = undefined;

       if (item.attempts >= OUTBOX_MAX_ATTEMPTS) {
         item.status = "dead";
         /* Use injected nowMs for deterministic testing. */
         item.deadAt = nowIsoFromNowMs;
         continue;
       }

      const retryAfterMs =
        typeof result.retryAfterSec === "number" && result.retryAfterSec > 0
          ? Math.ceil(result.retryAfterSec * 1000)
          : null;
      const backoffMs = retryAfterMs ?? computeBackoffMs(item.attempts);
      item.nextAttemptAt = new Date(nowMs + backoffMs).toISOString();
    }

    this.writeAll(file);
  }

  public pruneDelivered(input?: { maxDeliveredToKeep?: number }): void {
    /* Keep file size under control. */
    const file = this.readAll();
    const keep = input?.maxDeliveredToKeep ?? DEFAULT_MAX_DELIVERED_TO_KEEP;

    this.pruneDeliveredInPlace(file, keep);
    this.writeAll(file);
  }

  public prune(input?: {
    maxDeliveredToKeep?: number;
    maxDeadToKeep?: number;
    maxDeadAgeMs?: number;
    nowMs?: number;
  }): void {
    /*
     * Run all retention policies in one go.
     * This is used by the periodic maintenance job.
     */
    const maxDeliveredToKeep = input?.maxDeliveredToKeep ?? DEFAULT_MAX_DELIVERED_TO_KEEP;
    const maxDeadToKeep = input?.maxDeadToKeep ?? DEFAULT_MAX_DEAD_TO_KEEP;
    const maxDeadAgeMs = input?.maxDeadAgeMs ?? DEFAULT_MAX_DEAD_AGE_MS;
    const nowMs = input?.nowMs ?? Date.now();

    const file = this.readAll();

    /* First, cap delivered history (fast path for the most common growth). */
    this.pruneDeliveredInPlace(file, maxDeliveredToKeep);

    /*
     * Then prune dead-letter messages.
     * We use deadAt when available; fallback to createdAt for backward compatibility.
     */
    const dead = file.items.filter((i) => i.status === "dead");
    if (dead.length === 0) {
      this.writeAll(file);
      return;
    }

    const deadWithTs = dead.map((i) => ({ item: i, ts: parseIso(i.deadAt ?? i.createdAt) }));

    /* Drop items older than age limit. */
    const minTs = nowMs - maxDeadAgeMs;
    let keepDead = deadWithTs.filter((pair) => pair.ts === 0 || pair.ts >= minTs);

    /* Also cap by count; keep newest items. */
    if (keepDead.length > maxDeadToKeep) {
      keepDead = keepDead
        .slice()
        .sort((a, b) => a.ts - b.ts)
        .slice(keepDead.length - maxDeadToKeep);
    }

    const keepDeadIds = new Set(keepDead.map((pair) => pair.item.id));
    file.items = file.items.filter((i) => i.status !== "dead" || keepDeadIds.has(i.id));
    this.writeAll(file);
  }

  private pruneDeliveredInPlace(file: OutboxFile, keep: number): void {
    /* Drop oldest delivered items beyond the keep limit. */
    const delivered = file.items.filter((i) => i.status === "delivered");
    if (delivered.length <= keep) {
      return;
    }

    /* Sort by deliveredAt, oldest first. */
    const deliveredSorted = delivered
      .slice()
      .sort((a, b) => parseIso(a.deliveredAt) - parseIso(b.deliveredAt));
    const toDrop = new Set(deliveredSorted.slice(0, deliveredSorted.length - keep).map((i) => i.id));
    file.items = file.items.filter((i) => !toDrop.has(i.id));
  }

  private readAll(): OutboxFile {
    /* Recover from malformed JSON while preserving the broken file for manual inspection. */
    return readJsonFileSync({
      filePath: this.filePath,
      label: "telegram-outbox",
      createEmptyValue: () => ({ items: [] }),
      normalize: (parsed) => {
        const file = parsed as OutboxFile | null | undefined;
        return {
          items: Array.isArray(file?.items) ? file.items : []
        };
      },
      parseErrorStrategy: "recover",
      normalizeErrorStrategy: "recover"
    });
  }

  private writeAll(file: OutboxFile): void {
    /* Persist stable JSON for manual debugging and crash-safe recovery. */
    writeJsonFileSyncAtomic(this.filePath, file);
  }

  private findRecentPlainDuplicate(input: {
    items: TelegramOutboxItem[];
    input: {
      adminId: number;
      chatId: number;
      text: string;
      parseMode?: "HTML";
      disableNotification?: boolean;
      replyMarkup?: {
        inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>;
      };
    };
    nowMs: number;
  }): TelegramOutboxItem | null {
    /* Only suppress exact duplicates that appear almost immediately; later repeats may be intentional. */
    for (let index = input.items.length - 1; index >= 0; index -= 1) {
      const item = input.items[index];
      const itemTsMs = parseIso(item.deliveredAt ?? item.createdAt);
      if (itemTsMs > 0 && input.nowMs - itemTsMs > PLAIN_MESSAGE_DEDUP_WINDOW_MS) {
        break;
      }

      if (item.status !== "pending" && item.status !== "delivered") {
        continue;
      }

      if (item.adminId !== input.input.adminId || item.chatId !== input.input.chatId) {
        continue;
      }

      if (item.control || item.progressKey || (item.mode && item.mode !== "send")) {
        continue;
      }

      if (
        item.text === input.input.text &&
        item.parseMode === input.input.parseMode &&
        item.disableNotification === input.input.disableNotification &&
        areInlineKeyboardsEqual(item.replyMarkup, input.input.replyMarkup)
      ) {
        return item;
      }
    }

    return null;
  }
}
