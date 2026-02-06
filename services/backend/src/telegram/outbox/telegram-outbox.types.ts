/**
 * @fileoverview Telegram outbox types and constants.
 *
 * Exports:
 * - TELEGRAM_MAX_TEXT_CHARS (L18) - Hard Telegram limit for text messages.
 * - TELEGRAM_SAFE_CHUNK_CHARS (L21) - Conservative chunk size to avoid edge cases.
 * - OUTBOX_MAX_ATTEMPTS (L24) - Bounded retry limit for delivery.
 * - OUTBOX_LEASE_MS (L27) - Lease time for pulled messages.
 * - TelegramOutboxItem (L36) - Persistent outbox record.
 * - OutboxPullItem (L63) - DTO returned to bot.
 * - OutboxReportResult (L71) - Delivery report from bot.
 */

export const TELEGRAM_MAX_TEXT_CHARS = 4096;

/*
 * Leave headroom for Telegram quirks (entities, newlines) and future prefixes.
 * We keep it well under the official limit.
 */
export const TELEGRAM_SAFE_CHUNK_CHARS = 3900;

/* Keep retries bounded; after that we mark as dead and stop spamming Telegram. */
export const OUTBOX_MAX_ATTEMPTS = 20;

/*
 * Lease prevents duplicates between concurrent bot polls.
 * If bot crashes mid-send, the message becomes available again after the lease.
 */
export const OUTBOX_LEASE_MS = 30_000;

export type TelegramOutboxItem = {
  id: string;
  adminId: number;
  chatId: number;
  text: string;
  parseMode?: "HTML";
  disableNotification?: boolean;
  mode?: "send" | "replace";
  progressKey?: string;
  control?: {
    kind: "thinking";
    action: "start" | "stop";
  };
  replyMarkup?: {
    inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>;
  };
  createdAt: string;

  /* Delivery state. */
  status: "pending" | "delivered" | "dead";
  attempts: number;
  nextAttemptAt: string;
  lastError?: string;

  /* Leasing for polling workers. */
  inFlightUntil?: string;
  inFlightBy?: string;

  /* Telegram delivery result. */
  telegramMessageId?: number;
  deliveredAt?: string;
};

export type OutboxPullItem = {
  id: string;
  chatId: number;
  text: string;
  parseMode?: "HTML";
  disableNotification?: boolean;
  mode?: "send" | "replace";
  progressKey?: string;
  control?: {
    kind: "thinking";
    action: "start" | "stop";
  };
  replyMarkup?: {
    inlineKeyboard: Array<Array<{ text: string; callback_data: string }>>;
  };
};

export type OutboxReportResult = {
  id: string;
  ok: boolean;
  telegramMessageId?: number;
  error?: string;
  retryAfterSec?: number;
};
