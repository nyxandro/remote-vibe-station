/**
 * @fileoverview Small pure helpers for Telegram runtime bridge internals.
 *
 * Exports:
 * - buildAssistantPartKey - Creates stable per-part assistant buffer keys.
 * - extractPatternMatches - Runs global regexes deterministically for repeated scans.
 */

export const buildAssistantPartKey = (adminId: number, sessionID: string, partID: string): string =>
  `assistant-part:${adminId}:${sessionID}:${partID || "part"}`;

export const extractPatternMatches = (text: string, pattern: RegExp): string[] => {
  /* Reset global regex state on every scan so repeated calls stay deterministic. */
  pattern.lastIndex = 0;
  return Array.from(text.matchAll(pattern)).map((entry) => String(entry[0] ?? ""));
};
