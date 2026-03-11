/**
 * @fileoverview Tests for Telegram runtime turn gate retention.
 *
 * Exports:
 * - none (Jest suite).
 */

import { TelegramRuntimeTurnState } from "../telegram-runtime-turn-state";

describe("TelegramRuntimeTurnState", () => {
  test("closes a session until the next explicit turn starts", () => {
    /* Final replies should fence late runtime replay until a new prompt explicitly reopens the session. */
    const state = new TelegramRuntimeTurnState();

    state.closeTurn("session-1");
    expect(state.isTurnOpen("session-1")).toBe(false);

    state.openTurn("session-1");
    expect(state.isTurnOpen("session-1")).toBe(true);
  });

  test("expires closed-turn fences after ttl", () => {
    /* Fences are bounded in memory and should eventually expire for abandoned sessions. */
    const state = new TelegramRuntimeTurnState();
    const nowSpy = jest.spyOn(Date, "now");

    nowSpy.mockReturnValue(1_000);
    state.closeTurn("session-stale");

    nowSpy.mockReturnValue(24 * 60 * 60 * 1000 + 2_000);
    expect(state.isTurnOpen("session-stale")).toBe(true);
    nowSpy.mockRestore();
  });
});
