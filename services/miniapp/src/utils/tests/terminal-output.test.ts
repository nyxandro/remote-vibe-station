/**
 * @fileoverview Tests for terminal chunk sanitization.
 */

import { describe, expect, it } from "vitest";

import { sanitizeTerminalChunk } from "../terminal-output";

describe("sanitizeTerminalChunk", () => {
  it("removes bracketed-paste toggle escape sequence", () => {
    /* Bash emits these control sequences on prompt repaint in PTY mode. */
    const raw = "\u001b[?2004huser@host:~$ ";
    expect(sanitizeTerminalChunk(raw)).toBe("user@host:~$ ");
  });

  it("removes ANSI color sequences", () => {
    /* Color escapes should not leak into plain-text preformatted output. */
    const raw = "\u001b[31mERROR\u001b[0m";
    expect(sanitizeTerminalChunk(raw)).toBe("ERROR");
  });

  it("keeps normal text and newlines", () => {
    /* Readability must remain intact for multiline command output. */
    const raw = "line1\nline2\tok";
    expect(sanitizeTerminalChunk(raw)).toBe("line1\nline2\tok");
  });
});
