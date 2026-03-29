/**
 * @fileoverview Tests for terminal chunk sanitization.
 */

import { describe, expect, it } from "vitest";

import { mergeTerminalTranscript, sanitizeTerminalChunk } from "../terminal-output";

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

describe("mergeTerminalTranscript", () => {
  it("does not duplicate a prompt already present in the snapshot", () => {
    /* Initial hydration can race with the first live chunk, so repeated prompt text must collapse into one copy. */
    expect(mergeTerminalTranscript("user@host:~$ ", "user@host:~$ ")).toBe("user@host:~$ ");
  });

  it("preserves only the non-overlapping live tail", () => {
    /* Overlap detection should keep incremental command output without repeating the shared suffix/prefix fragment. */
    expect(mergeTerminalTranscript("user@host:~$ pwd\n", "pwd\n/home/demo\n")).toBe(
      "user@host:~$ pwd\n/home/demo\n"
    );
  });

  it("appends the full live tail when there is no overlap", () => {
    /* Independent terminal chunks still need a straight concatenation path once no common boundary exists. */
    expect(mergeTerminalTranscript("user@host:~$ ", "ls\nREADME.md\n")).toBe("user@host:~$ ls\nREADME.md\n");
  });
});
