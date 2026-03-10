/**
 * @fileoverview Tests for TelegramAssistantPartState late-replay protection.
 *
 * Exports:
 * - (none)
 */

import { TelegramAssistantPartState } from "../telegram-assistant-part-state";

describe("TelegramAssistantPartState", () => {
  test("closes active text parts and rejects the same part id on replay", () => {
    /* A finalized text part must stay closed so OpenCode replay cannot reopen duplicate commentary. */
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000);
    const state = new TelegramAssistantPartState();

    expect(state.rememberOpenTextPart("session-1", "part-1")).toBe(true);

    state.closeOpenTextParts("session-1");

    expect(state.isClosedTextPart("session-1", "part-1")).toBe(true);
    expect(state.rememberOpenTextPart("session-1", "part-1")).toBe(false);
    nowSpy.mockRestore();
  });

  test("prunes stale session state after ttl expires", () => {
    /* Replay guards should be temporary so sessions that disappear do not leak memory forever. */
    const nowSpy = jest.spyOn(Date, "now");
    const state = new TelegramAssistantPartState();

    nowSpy.mockReturnValue(1_000);
    expect(state.rememberOpenTextPart("stale-session", "stale-part")).toBe(true);
    state.closeOpenTextParts("stale-session");
    expect(state.isClosedTextPart("stale-session", "stale-part")).toBe(true);

    nowSpy.mockReturnValue(1_802_000);
    expect(state.rememberOpenTextPart("fresh-session", "fresh-part")).toBe(true);
    expect(state.isClosedTextPart("stale-session", "stale-part")).toBe(false);
    nowSpy.mockRestore();
  });
});
