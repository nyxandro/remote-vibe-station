/**
 * @fileoverview Tests for Telegram footer formatting.
 *
 * Exports:
 * - (none)
 */

import { formatTelegramFooter } from "../telegram-footer";

describe("formatTelegramFooter", () => {
  it("marks footer as markdown quote line for Telegram blockquote rendering", () => {
    const footer = formatTelegramFooter({
      contextUsedTokens: 13341,
      contextLimitTokens: 400000,
      providerID: "opencode",
      modelID: "gpt-5-nano",
      thinking: "high",
      agent: "build"
    });

    expect(footer.startsWith("> ")).toBe(true);
  });

  it("prints thinking and agent in the last two columns", () => {
    const footer = formatTelegramFooter({
      contextUsedTokens: 10817,
      contextLimitTokens: 300000,
      providerID: "opencode",
      modelID: "gpt-5-nano",
      thinking: "high",
      agent: "build"
    });

    expect(footer).toContain("| high | build");
  });

  it("falls back to default thinking label when not provided", () => {
    const footer = formatTelegramFooter({
      contextUsedTokens: 100,
      contextLimitTokens: 1000,
      providerID: "opencode",
      modelID: "big-pickle",
      thinking: null,
      agent: "plan"
    });

    expect(footer).toContain("| default | plan");
  });

  it("infers context percentage for gpt-5.2 when explicit limit is absent", () => {
    /* CLIProxy model catalogs do not expose context limits, so footer must infer known GPT limits. */
    const footer = formatTelegramFooter({
      contextUsedTokens: 13997,
      contextLimitTokens: null,
      providerID: "cliproxy",
      modelID: "gpt-5.2",
      thinking: null,
      agent: "build"
    });

    expect(footer).toContain("| 3% | cliproxy/gpt-5.2 |");
    expect(footer.includes("?%")).toBe(false);
  });

  it("infers context percentage for gpt-5.4 using expanded context window", () => {
    /* GPT-5.4 has a larger context window and should not reuse the 400k fallback. */
    const footer = formatTelegramFooter({
      contextUsedTokens: 525000,
      contextLimitTokens: null,
      providerID: "cliproxy",
      modelID: "gpt-5.4",
      thinking: "high",
      agent: "build"
    });

    expect(footer).toContain("| 50% | cliproxy/gpt-5.4 |");
  });
});
