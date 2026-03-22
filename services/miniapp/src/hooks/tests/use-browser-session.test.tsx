/**
 * @fileoverview Tests for browser-session sliding token refresh and expiry signalling.
 *
 * Exports:
 * - (none)
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useBrowserSession } from "../use-browser-session";
import {
  BROWSER_SESSION_EXPIRED_EVENT,
  readStoredWebTokenMetadata,
  refreshWebToken
} from "../../api/client";

vi.mock("../../api/client", () => ({
  BROWSER_SESSION_EXPIRED_EVENT: "tvoc:browser-session-expired",
  clearStoredWebToken: vi.fn(),
  readStoredWebTokenMetadata: vi.fn(),
  refreshWebToken: vi.fn()
}));

describe("useBrowserSession", () => {
  let currentToken: { token: string; issuedAtMs: number; expiresAtMs: number } | null;

  beforeEach(() => {
    /* Fake timers keep expiry-threshold checks deterministic across refresh scenarios. */
    currentToken = {
      token: "browser-token",
      issuedAtMs: Date.parse("2026-03-22T09:00:00.000Z"),
      expiresAtMs: Date.parse("2026-03-22T09:04:00.000Z")
    };

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T09:00:00.000Z"));
    vi.mocked(readStoredWebTokenMetadata).mockImplementation(() => currentToken);
    vi.mocked(refreshWebToken).mockImplementation(async () => {
      currentToken = {
        token: "browser-token-refreshed",
        issuedAtMs: Date.parse("2026-03-22T09:00:00.000Z"),
        expiresAtMs: Date.parse("2026-03-22T12:00:00.000Z")
      };
      return {
        token: currentToken.token,
        expiresAt: new Date(currentToken.expiresAtMs).toISOString()
      };
    });
    sessionStorage.clear();
  });

  afterEach(() => {
    /* Restore globals so session hook timing cannot leak into other suites. */
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("refreshes the browser token only after real user interaction near expiry", async () => {
    /* Idle tabs must not prolong access on their own, but active tabs should renew before the token lapses. */
    renderHook(() => useBrowserSession());

    await act(async () => {
      vi.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(refreshWebToken).not.toHaveBeenCalled();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
      await Promise.resolve();
    });

    expect(refreshWebToken).toHaveBeenCalledTimes(1);
  });

  it("exposes session-ended state when the API client announces auth expiry", () => {
    /* Root UI should be able to swap into a blocking overlay as soon as bearer auth becomes invalid. */
    const { result } = renderHook(() => useBrowserSession());

    act(() => {
      window.dispatchEvent(
        new CustomEvent(BROWSER_SESSION_EXPIRED_EVENT, {
          detail: { message: "Сеанс завершен. Закрой Mini App и открой его заново." }
        })
      );
    });

    expect(result.current.isSessionExpired).toBe(true);
    expect(result.current.sessionExpiredMessage).toContain("Сеанс завершен");
  });
});
