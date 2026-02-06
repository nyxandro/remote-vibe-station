/**
 * @fileoverview Tests for splitTelegramTextWithFooter.
 *
 * Tests:
 * - footer is appended to last chunk when it fits (L18).
 * - footer becomes a separate chunk when it doesn't fit (L34).
 */

import { splitTelegramTextWithFooter } from "../telegram-split-with-footer";

describe("splitTelegramTextWithFooter", () => {
  it("appends footer to the last chunk when it fits", () => {
    const chunks = splitTelegramTextWithFooter("hello", "FOOT");
    expect(chunks).toEqual(["hello\n\nFOOT"]);
  });

  it("adds footer as a separate chunk when it doesn't fit", () => {
    const body = "a".repeat(3900);
    const footer = "b".repeat(3900);
    const chunks = splitTelegramTextWithFooter(body, footer);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(3900);
    expect(chunks[1]).toBe(footer);
  });
});
