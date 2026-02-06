/**
 * @fileoverview Telegram message footer formatting (tokens/model/thinking/agent).
 *
 * Exports:
 * - formatTelegramFooter (L23) - Formats a single-line footer as markdown quote.
 */

type FooterInput = {
  contextUsedTokens: number;
  contextLimitTokens?: number | null;
  providerID: string;
  modelID: string;
  thinking?: string | null;
  agent?: string | null;
};

const formatInt = (value: number): string => {
  /* Format number with spaces as thousands separators. */
  const s = String(Math.max(0, Math.floor(value)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
};

export const formatTelegramFooter = (input: FooterInput): string => {
  /*
    * Keep footer compact and stable for scanning.
   * Example: 114 439 | 36% | openai/gpt-5.2 | high | build
   */
  const used = formatInt(input.contextUsedTokens);
  const percent =
    input.contextLimitTokens && input.contextLimitTokens > 0
      ? `${Math.round((input.contextUsedTokens / input.contextLimitTokens) * 100)}%`
      : "?%";
  const model = `${input.providerID}/${input.modelID}`;
  const thinking = input.thinking && input.thinking.trim().length > 0 ? input.thinking.trim() : "default";
  const agent = input.agent && input.agent.trim().length > 0 ? input.agent.trim() : "build";

  /* Prefix with markdown quote marker so Telegram renderer can show blockquote style. */
  return `> ${used} | ${percent} | ${model} | ${thinking} | ${agent}`;
};
