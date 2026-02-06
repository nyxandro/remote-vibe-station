/**
 * @fileoverview Tests for markdown-to-Telegram-HTML formatter.
 *
 * Exports:
 * - (none)
 */

import { renderTelegramHtmlFromMarkdown } from "../telegram-markdown";

describe("renderTelegramHtmlFromMarkdown", () => {
  it("converts fenced code block to pre/code html with language label", () => {
    const result = renderTelegramHtmlFromMarkdown("Вывод:\n```output\n1\n2\n3\n```");
    expect(result).toContain("<b>output:</b>");
    expect(result).toContain("<pre><code>1\n2\n3\n</code></pre>");
    expect(result).not.toContain("```");
  });

  it("converts inline code and escapes angle brackets", () => {
    const result = renderTelegramHtmlFromMarkdown("Запусти `ls -la` и проверь <tag>");
    expect(result).toContain("<code>ls -la</code>");
    expect(result).toContain("&lt;tag&gt;");
  });

  it("converts markdown quote lines to Telegram blockquote html", () => {
    const result = renderTelegramHtmlFromMarkdown("> 13 341 | 3% | opencode/gpt-5-nano | high | build");
    expect(result).toContain("<blockquote>13 341 | 3% | opencode/gpt-5-nano | high | build</blockquote>");
    expect(result).not.toContain("&gt;");
  });
});
