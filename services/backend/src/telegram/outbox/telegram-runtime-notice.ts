/**
 * @fileoverview Shared helpers for Telegram delivery of OpenCode runtime notices.
 *
 * Exports:
 * - TELEGRAM_SESSION_STOP_CALLBACK_DATA - Callback payload for stopping the active Telegram/OpenCode run.
 * - extractRuntimeNoticeMatches - Finds cooldown/system reminder notices in buffered assistant text.
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

export const buildCooldownReplyMarkup = () => {
  /* Cooldown notice needs one explicit escape hatch so the operator can stop retries without typing a command manually. */
  return {
    inlineKeyboard: [[{ text: "⏹ Стоп", callback_data: TELEGRAM_SESSION_STOP_CALLBACK_DATA }]]
  };
};
