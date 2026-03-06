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

const GPT5_DEFAULT_CONTEXT_LIMIT = 400_000;
const GPT54_CONTEXT_LIMIT = 1_050_000;
const GPT53_CODEX_SPARK_CONTEXT_LIMIT = 128_000;

const formatInt = (value: number): string => {
  /* Format number with spaces as thousands separators. */
  const s = String(Math.max(0, Math.floor(value)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
};

const inferContextLimitTokens = (modelID: string): number | null => {
  /* CLIProxy /v1/models does not expose limits, so we infer known GPT-5 windows from model id. */
  const normalized = String(modelID ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  /* Spark variant has a narrower context than regular GPT-5 snapshots. */
  if (normalized.includes("gpt-5.3-codex-spark")) {
    return GPT53_CODEX_SPARK_CONTEXT_LIMIT;
  }

  /* GPT-5.4 family uses expanded 1.05M context. */
  if (normalized.startsWith("gpt-5.4")) {
    return GPT54_CONTEXT_LIMIT;
  }

  /* Other GPT-5 snapshots in current catalog share 400k context. */
  if (normalized.startsWith("gpt-5")) {
    return GPT5_DEFAULT_CONTEXT_LIMIT;
  }

  return null;
};

export const formatTelegramFooter = (input: FooterInput): string => {
  /*
    * Keep footer compact and stable for scanning.
   * Example: 114 439 | 36% | openai/gpt-5.2 | high | build
   */
  const used = formatInt(input.contextUsedTokens);
  const resolvedContextLimit =
    input.contextLimitTokens && input.contextLimitTokens > 0
      ? input.contextLimitTokens
      : inferContextLimitTokens(input.modelID);
  const percent =
    resolvedContextLimit && resolvedContextLimit > 0
      ? `${Math.round((input.contextUsedTokens / resolvedContextLimit) * 100)}%`
      : "?%";
  const model = `${input.providerID}/${input.modelID}`;
  const thinking = input.thinking && input.thinking.trim().length > 0 ? input.thinking.trim() : "default";
  const agent = input.agent && input.agent.trim().length > 0 ? input.agent.trim() : "build";

  /* Prefix with markdown quote marker so Telegram renderer can show blockquote style. */
  return `> ${used} | ${percent} | ${model} | ${thinking} | ${agent}`;
};
