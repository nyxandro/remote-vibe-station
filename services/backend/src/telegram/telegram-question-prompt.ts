/**
 * @fileoverview Helpers for Telegram rendering of OpenCode question prompts.
 *
 * Exports:
 * - formatTelegramQuestionPrompt - Builds stable Telegram text for one question step.
 */

type FormatTelegramQuestionPromptInput = {
  header: string;
  question: string;
  index: number;
  total: number;
};

export const formatTelegramQuestionPrompt = (input: FormatTelegramQuestionPromptInput): string => {
  /* Multi-question requests need numbering so the operator understands that more steps are coming. */
  const title = input.total > 1 ? `OpenCode спрашивает (${input.index}/${input.total}):` : "OpenCode спрашивает:";

  /* OpenCode headers are helpful when present, but the generic fallback header should stay hidden. */
  const header = input.header.trim();
  const normalizedHeader = header.toLowerCase();
  const lines = [title];
  if (header && normalizedHeader !== "question") {
    lines.push(header);
  }

  /* Question body is the main operator-facing text and must always be preserved verbatim. */
  lines.push(input.question.trim());
  return lines.join("\n");
};
