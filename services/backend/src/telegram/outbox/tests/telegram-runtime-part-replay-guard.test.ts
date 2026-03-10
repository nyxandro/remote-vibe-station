/**
 * @fileoverview Tests for TelegramRuntimePartReplayGuard finalized-part replay protection.
 *
 * Exports/constructs:
 * - describe("TelegramRuntimePartReplayGuard", ...) - Verifies duplicate finalized part ids are rejected per session.
 */

import { TelegramRuntimePartReplayGuard } from "../telegram-runtime-part-replay-guard";

describe("TelegramRuntimePartReplayGuard", () => {
  it("rejects the same finalized part id on replay within one session", () => {
    /* A completed tool part should produce one Telegram event even if OpenCode replays it later. */
    const guard = new TelegramRuntimePartReplayGuard();

    expect(guard.rememberFinalizedPart("session-1", "part-1")).toBe(true);
    expect(guard.rememberFinalizedPart("session-1", "part-1")).toBe(false);
    expect(guard.rememberFinalizedPart("session-1", "part-2")).toBe(true);
  });

  it("keeps finalized ids isolated between sessions", () => {
    /* Independent sessions may reuse runtime part ids without blocking each other. */
    const guard = new TelegramRuntimePartReplayGuard();

    expect(guard.rememberFinalizedPart("session-a", "part-1")).toBe(true);
    expect(guard.rememberFinalizedPart("session-b", "part-1")).toBe(true);
  });
});
