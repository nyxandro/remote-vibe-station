/**
 * @fileoverview Shared helpers for Telegram delivery of OpenCode runtime notices.
 *
 * Exports:
 * - TELEGRAM_SESSION_STOP_CALLBACK_DATA - Callback payload for stopping the active Telegram/OpenCode run.
 * - extractRuntimeNoticeMatches - Finds cooldown/system reminder notices in buffered assistant text.
 * - formatRetryStatusCooldownNotice - Reconstructs a readable cooldown notice from session.status retry payloads.
 * - buildCooldownReplyMarkup - Builds inline keyboard for aborting the active run from Telegram.
 */

import { extractPatternMatches } from "./telegram-runtime-bridge-utils";

export const TELEGRAM_SESSION_STOP_CALLBACK_DATA = "sess-stop|active";

const COOLDOWN_MESSAGE_PATTERN = /All credentials for model[\s\S]*?(?:попытка №\d+|attempt #\d+)/gi;
const SYSTEM_REMINDER_PATTERN = /<system-reminder>[\s\S]*?<\/system-reminder>/gi;

export type TelegramRuntimeNoticeMatch = {
  kind: "cooldown" | "system-reminder";
  text: string;
};

const COOLDOWN_MESSAGE_PREFIX = "All credentials for model";

const formatRetryDelaySeconds = (next: unknown): number | null => {
  /* Retry payloads may encode the next retry as absolute timestamp, milliseconds, or bare seconds depending on emitter path. */
  if (typeof next !== "number" || !Number.isFinite(next) || next <= 0) {
    return null;
  }

  if (next > 10_000_000_000) {
    return Math.max(1, Math.ceil((next - Date.now()) / 1000));
  }

  if (next > 1000) {
    return Math.max(1, Math.ceil(next / 1000));
  }

  return Math.max(1, Math.ceil(next));
};

export const extractRuntimeNoticeMatches = (text: string): TelegramRuntimeNoticeMatch[] => {
  /* Runtime notices can arrive mixed into assistant text, so parse both cooldowns and XML-like system reminders from one buffer. */
  const matches = [
    ...extractPatternMatches(text, COOLDOWN_MESSAGE_PATTERN).map((item) => ({
      kind: "cooldown" as const,
      text: item
    })),
    ...extractPatternMatches(text, SYSTEM_REMINDER_PATTERN).map((item) => ({
      kind: "system-reminder" as const,
      text: item
    }))
  ];

  return matches;
};

export const formatRetryStatusCooldownNotice = (status: {
  message?: unknown;
  attempt?: unknown;
  next?: unknown;
}): string | null => {
  /* Session retry events sometimes split cooldown text from retry metadata, so reconstruct the exact operator-facing notice explicitly. */
  const message = typeof status.message === "string" ? status.message.trim() : "";
  if (!message || !message.includes(COOLDOWN_MESSAGE_PREFIX)) {
    return null;
  }

  if (/попытка №\d+|attempt #\d+/i.test(message)) {
    return message;
  }

  const attempt =
    typeof status.attempt === "number" &&
    Number.isFinite(status.attempt) &&
    Number.isInteger(status.attempt) &&
    status.attempt > 0
      ? status.attempt
      : null;
  const delaySeconds = formatRetryDelaySeconds(status.next);
  if (!attempt && !delaySeconds) {
    return message;
  }

  const suffixParts = [delaySeconds ? `повтор через ${delaySeconds}с` : null, attempt ? `попытка №${attempt}` : null].filter(
    (item): item is string => Boolean(item)
  );

  return suffixParts.length > 0 ? `${message}\n${suffixParts.join(" - ")}` : message;
};

export const buildCooldownReplyMarkup = () => {
  /* Cooldown notice needs one explicit escape hatch so the operator can stop retries without typing a command manually. */
  return {
    inlineKeyboard: [[{ text: "⏹ Стоп", callback_data: TELEGRAM_SESSION_STOP_CALLBACK_DATA }]]
  };
};
