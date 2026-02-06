/**
 * @fileoverview Utilities for sending chunked Telegram messages.
 *
 * Exports:
 * - MAX_MESSAGE_LENGTH (L8) - Chunk size limit.
 * - splitMessage (L10) - Split text into Telegram-sized chunks.
 */

const MAX_MESSAGE_LENGTH = 3500;

export const splitMessage = (text: string): string[] => {
  /* Split message into safe chunks for Telegram. */
  if (text.length <= MAX_MESSAGE_LENGTH) {
    return [text];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    chunks.push(text.slice(cursor, cursor + MAX_MESSAGE_LENGTH));
    cursor += MAX_MESSAGE_LENGTH;
  }

  return chunks;
};
