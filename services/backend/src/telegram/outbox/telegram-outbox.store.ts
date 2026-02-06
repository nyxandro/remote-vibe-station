/**
 * @fileoverview Persistent outbox for reliable Telegram delivery.
 *
 * Why:
 * - Telegram Bot API calls can fail due to transient network issues.
 * - Bot process can restart; we must not lose assistant replies.
 * - Backend has a mounted `./data` volume in docker-compose; store lives there.
 *
 * Exports:
 * - TelegramOutboxStore (L33) - Append/pull/report operations with leasing.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";

import {
  OUTBOX_LEASE_MS,
  OUTBOX_MAX_ATTEMPTS,
  OutboxPullItem,
  OutboxReportResult,
  TelegramOutboxItem
} from "./telegram-outbox.types";

const DATA_DIR = "data";
const FILE_NAME = "telegram.outbox.json";

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
        item.deliveredAt = nowIso();
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
    const keep = input?.maxDeliveredToKeep ?? 1_000;

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
    this.writeAll(file);
  }

  private readAll(): OutboxFile {
    /* Ensure data directory exists. */
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.filePath)) {
      return { items: [] };
    }

    return JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as OutboxFile;
  }

  private writeAll(file: OutboxFile): void {
    /* Persist stable JSON for manual debugging. */
    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), "utf-8");
  }
}
