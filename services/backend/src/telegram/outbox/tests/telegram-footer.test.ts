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
});
