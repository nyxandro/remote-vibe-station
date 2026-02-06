/**
 * @fileoverview Markdown-to-Telegram-HTML formatter for bot messages.
 *
 * Exports:
 * - renderTelegramHtmlFromMarkdown (L67) - Converts fenced/inline code and quote lines.
 */

const FENCED_CODE_REGEX = /```([^\n`]*)\n([\s\S]*?)```/g;
const INLINE_CODE_REGEX = /`([^`\n]+)`/g;
const BLOCKQUOTE_LINE_REGEX = /^>\s?(.*)$/;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const normalizeFenceLanguage = (raw: string): string | null => {
  /* Keep short, safe label for code fence language line. */
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  /* Telegram text should remain compact; avoid noisy/invalid labels. */
  if (!/^[a-z0-9_+-]{1,24}$/.test(normalized)) {
    return null;
  }

  return normalized;
};

const renderInlineCode = (text: string): string => {
  /* Convert inline markdown code markers to Telegram HTML <code>. */
  const escaped = escapeHtml(text);
  return escaped.replace(INLINE_CODE_REGEX, (_all, code: string) => `<code>${escapeHtml(code)}</code>`);
};

const renderPlainSegment = (text: string): string => {
  /* Convert markdown quote marker to Telegram HTML blockquote line-by-line. */
  return text
    .split("\n")
    .map((line) => {
      const match = BLOCKQUOTE_LINE_REGEX.exec(line);
      if (!match) {
        return renderInlineCode(line);
      }

      const quotedText = match[1] ?? "";
      return `<blockquote>${renderInlineCode(quotedText)}</blockquote>`;
    })
    .join("\n");
};

export const renderTelegramHtmlFromMarkdown = (markdown: string): string => {
  /*
   * Convert fenced code blocks first, then inline code in plain segments.
   * We keep the rest as escaped text to avoid Telegram HTML parse errors.
   */
  const source = String(markdown ?? "");
  let output = "";
  let cursor = 0;

  for (const match of source.matchAll(FENCED_CODE_REGEX)) {
    const index = match.index ?? 0;
    const plainSegment = source.slice(cursor, index);
    output += renderPlainSegment(plainSegment);

    const language = normalizeFenceLanguage(String(match[1] ?? ""));
    const codeContent = String(match[2] ?? "");
    if (language) {
      output += `<b>${escapeHtml(language)}:</b>\n`;
    }
    output += `<pre><code>${escapeHtml(codeContent)}</code></pre>`;
    cursor = index + match[0].length;
  }

  output += renderPlainSegment(source.slice(cursor));
  return output;
};
