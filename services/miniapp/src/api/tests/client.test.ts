/**
 * @fileoverview Tests for API client error normalization.
 */

/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  apiGet,
  bootstrapWebTokenFromTelegram,
  BROWSER_SESSION_EXPIRED_EVENT,
  readStoredWebTokenMetadata,
  refreshWebToken
} from "../client";

const STORAGE_KEY_WEB_TOKEN = "tvoc.miniapp.webToken";

const buildToken = (payload: Record<string, unknown>): string => {
  /* Tests only need a decodable browser token payload; signature bytes are irrelevant for client-side parsing. */
  return `${btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}.signature`;
};

describe("api client error formatting", () => {
  afterEach(() => {
    /* Reset global fetch and auth storage so each API error test starts from a clean browser state. */
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("formats structured backend errors with hint and requestId", async () => {
    /* UI error surfaces should preserve the backend message while also surfacing next-step hint and correlation id. */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: "APP_AUTH_REQUIRED",
            message: "Authentication is missing or invalid.",
            hint: "Provide Telegram initData or browser token and retry.",
            requestId: "req-401"
          }),
          { status: 401 }
        )
      )
    );

    await expect(apiGet("/api/projects")).rejects.toThrow(
      "Request failed: 401 - Authentication is missing or invalid. Provide Telegram initData or browser token and retry. [req-401]"
    );
  });

  it("falls back to raw response text for non-json backend failures", async () => {
    /* Non-JSON upstream errors should still stay readable instead of becoming generic parse errors. */
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gateway timeout", { status: 504 })));

    await expect(apiGet("/api/projects")).rejects.toThrow("Request failed: 504 - gateway timeout");
  });

  it("stores refreshed browser token metadata after successful renewal", async () => {
    /* Browser-only sessions should replace the in-tab token atomically so later API calls use the renewed credentials. */
    const currentToken = buildToken({ adminId: 42, iat: 1_000, exp: 10_000, nonce: "old" });
    const nextToken = buildToken({ adminId: 42, iat: 2_000, exp: 20_000, nonce: "new" });
    sessionStorage.setItem(STORAGE_KEY_WEB_TOKEN, currentToken);

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          token: nextToken,
          expiresAt: new Date(20_000).toISOString()
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await refreshWebToken();

    expect(result.token).toBe(nextToken);
    expect(sessionStorage.getItem(STORAGE_KEY_WEB_TOKEN)).toBe(nextToken);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/web-token/refresh",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${currentToken}`
        })
      })
    );
    expect(readStoredWebTokenMetadata()).toMatchObject({
      token: nextToken,
      issuedAtMs: 2_000,
      expiresAtMs: 20_000
    });
  });

  it("bootstraps a browser token from Telegram initData and stores it for later requests", async () => {
    /* Mini App sessions inside Telegram should exchange short-lived initData into the longer sliding bearer token immediately. */
    const nextToken = buildToken({ adminId: 42, iat: 2_000, exp: 20_000, nonce: "new" });
    (window as any).Telegram = {
      WebApp: {
        initData: "signed-init-data"
      }
    };

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          token: nextToken,
          expiresAt: new Date(20_000).toISOString()
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await bootstrapWebTokenFromTelegram();

    expect(result.token).toBe(nextToken);
    expect(sessionStorage.getItem(STORAGE_KEY_WEB_TOKEN)).toBe(nextToken);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/web-token/bootstrap",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-telegram-init-data": "signed-init-data"
        })
      })
    );
  });

  it("prefers stored browser token over Telegram initData once bootstrap completed", async () => {
    /* After bootstrap the app must stop relying on expiring initData for ordinary backend requests. */
    const currentToken = buildToken({ adminId: 42, iat: 1_000, exp: 10_000, nonce: "old" });
    sessionStorage.setItem(STORAGE_KEY_WEB_TOKEN, currentToken);
    (window as any).Telegram = {
      WebApp: {
        initData: "signed-init-data"
      }
    };

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await apiGet("/api/projects");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/projects",
      expect.objectContaining({
        headers: {
          Authorization: `Bearer ${currentToken}`
        }
      })
    );
  });

  it("emits browser-session-expired event and clears the stored token on auth expiry", async () => {
    /* Expired browser sessions should stop retry loops and hand control to the dedicated session-ended overlay. */
    const token = buildToken({ adminId: 42, iat: 1_000, exp: 10_000, nonce: "old" });
    sessionStorage.setItem(STORAGE_KEY_WEB_TOKEN, token);

    const expiredEvents: Array<CustomEvent<{ message?: string }>> = [];
    const handleExpired = (event: Event) => {
      expiredEvents.push(event as CustomEvent<{ message?: string }>);
    };
    window.addEventListener(BROWSER_SESSION_EXPIRED_EVENT, handleExpired as EventListener);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: "APP_WEB_TOKEN_INVALID",
            message: "Browser access token is invalid or expired.",
            hint: "Open the Mini App again to refresh the browser token."
          }),
          { status: 401 }
        )
      )
    );

    await expect(apiGet("/api/projects")).rejects.toThrow(
      "Request failed: 401 - Browser access token is invalid or expired. Open the Mini App again to refresh the browser token."
    );

    window.removeEventListener(BROWSER_SESSION_EXPIRED_EVENT, handleExpired as EventListener);
    expect(sessionStorage.getItem(STORAGE_KEY_WEB_TOKEN)).toBeNull();
    expect(expiredEvents).toHaveLength(1);
    expect(expiredEvents[0]?.detail.message).toContain("Browser access token is invalid or expired.");
  });
});
