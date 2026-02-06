/**
 * @fileoverview Splitting helper that ensures footer is present at the end.
 *
 * Exports:
 * - splitTelegramTextWithFooter (L18) - Splits body and appends footer to last chunk.
 */

import { TELEGRAM_SAFE_CHUNK_CHARS } from "./telegram-outbox.types";
import { splitTelegramText } from "./telegram-message-split";

const DOUBLE_NEWLINE = "\n\n";

export const splitTelegramTextWithFooter = (body: string, footerLine: string): string[] => {
  /*
   * Ensure the footer is always at the bottom of the final message.
   * If the last chunk cannot fit the footer, emit an extra chunk for the footer.
   */
  const footer = footerLine.trim().length > 0 ? `${DOUBLE_NEWLINE}${footerLine}` : "";
  const chunks = splitTelegramText(body);

  if (chunks.length === 0) {
    return footer ? [footerLine] : [""];
  }

  const last = chunks[chunks.length - 1];
  if (last.length + footer.length <= TELEGRAM_SAFE_CHUNK_CHARS) {
    chunks[chunks.length - 1] = `${last}${footer}`;
    return chunks;
  }

  /* Footer doesn't fit; place it into a separate chunk. */
  chunks.push(footerLine);
  return chunks;
};
