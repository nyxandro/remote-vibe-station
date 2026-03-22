/**
 * @fileoverview Tests for bot HTTP runtime helpers.
 */

import { DEFAULT_BOT_HTTP_PORT, resolveBotHttpPort, shouldAttachCookieDomain } from "../bot-http-runtime";

describe("bot HTTP runtime helpers", () => {
  test("falls back to default port for invalid values", () => {
    /* Polling/webhook bootstrap should stay predictable even when PORT env is malformed. */
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(resolveBotHttpPort(undefined)).toBe(DEFAULT_BOT_HTTP_PORT);
    expect(resolveBotHttpPort("0")).toBe(DEFAULT_BOT_HTTP_PORT);
    expect(resolveBotHttpPort("abc")).toBe(DEFAULT_BOT_HTTP_PORT);
    expect(resolveBotHttpPort("70000")).toBe(DEFAULT_BOT_HTTP_PORT);

    warn.mockRestore();
  });

  test("keeps cookie domain host-only for localhost and IP addresses", () => {
    /* Browser auth cookies must skip Domain on local/IP deployments to avoid invalid cookie scope. */
    expect(shouldAttachCookieDomain("localhost")).toBe(false);
    expect(shouldAttachCookieDomain("127.0.0.1")).toBe(false);
    expect(shouldAttachCookieDomain("203.0.113.5")).toBe(false);
    expect(shouldAttachCookieDomain("code.example.com")).toBe(true);
  });
});
