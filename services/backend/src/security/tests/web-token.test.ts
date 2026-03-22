/**
 * @fileoverview Tests for signed browser web-token TTL behavior.
 *
 * Exports:
 * - (none)
 */

import { createWebToken, verifyWebToken } from "../web-token";

describe("web-token", () => {
  it("keeps browser token valid for up to three hours of inactivity", () => {
    /* Browser sessions should survive normal work sessions, but still expire after the idle window closes. */
    const issuedAtMs = Date.parse("2026-03-22T09:00:00.000Z");
    const token = createWebToken({
      adminId: 42,
      botToken: "bot-token",
      nowMs: issuedAtMs
    });

    expect(
      verifyWebToken({
        token,
        botToken: "bot-token",
        nowMs: issuedAtMs + 3 * 60 * 60 * 1000 - 1
      })
    ).toEqual({ adminId: 42 });

    expect(
      verifyWebToken({
        token,
        botToken: "bot-token",
        nowMs: issuedAtMs + 3 * 60 * 60 * 1000
      })
    ).toBeNull();
  });
});
