/**
 * @fileoverview Helpers for grouping OpenCode assistant text parts.
 *
 * Exports:
 * - extractOpenCodeTextBlocks - Groups consecutive text parts into logical assistant messages.
 * - extractFinalOpenCodeText - Returns the last logical assistant text block.
 */

import { OpenCodePart } from "./opencode.types";

export const extractOpenCodeTextBlocks = (parts: OpenCodePart[] | undefined): string[] => {
  /* Keep consecutive text parts together, but split blocks whenever OpenCode inserts a non-text part. */
  const blocks: string[] = [];
  let current = "";

  for (const part of parts ?? []) {
    if (part?.type === "text") {
      current += String((part as { text?: string }).text ?? "");
      continue;
    }

    if (current.length > 0) {
      blocks.push(current);
      current = "";
    }
  }

  if (current.length > 0) {
    blocks.push(current);
  }

  return blocks;
};

export const extractFinalOpenCodeText = (parts: OpenCodePart[] | undefined): string => {
  /* Telegram final replace should carry only the trailing assistant text block, not the whole streamed transcript. */
  const blocks = extractOpenCodeTextBlocks(parts);
  return blocks.at(-1) ?? "";
};
