/**
 * @fileoverview Helpers to split long text into Telegram-safe chunks.
 *
 * Exports:
 * - splitTelegramText (L19) - Splits arbitrary text to <= TELEGRAM_SAFE_CHUNK_CHARS.
 */

import { TELEGRAM_SAFE_CHUNK_CHARS } from "./telegram-outbox.types";

const NEWLINE = "\n";

export const splitTelegramText = (text: string): string[] => {
  /*
   * Split by paragraphs/newlines first, then fall back to hard slicing.
   * This keeps messages readable while staying inside Telegram limits.
   */
  const normalized = String(text ?? "");
  if (normalized.length <= TELEGRAM_SAFE_CHUNK_CHARS) {
    return [normalized];
  }

  const lines = normalized.split(NEWLINE);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = (): void => {
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
  };

  for (const line of lines) {
    const next = current.length === 0 ? line : `${current}${NEWLINE}${line}`;
    if (next.length <= TELEGRAM_SAFE_CHUNK_CHARS) {
      current = next;
      continue;
    }

    /* Flush accumulated chunk and handle an oversized line separately. */
    pushCurrent();

    if (line.length <= TELEGRAM_SAFE_CHUNK_CHARS) {
      current = line;
      continue;
    }

    /* Hard-slice extremely long lines (e.g. minified JSON). */
    for (let i = 0; i < line.length; i += TELEGRAM_SAFE_CHUNK_CHARS) {
      chunks.push(line.slice(i, i + TELEGRAM_SAFE_CHUNK_CHARS));
    }
  }

  pushCurrent();
  return chunks;
};
