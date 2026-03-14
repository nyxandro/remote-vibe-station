/**
 * @fileoverview Tests for localhost-only auth bypass helpers.
 *
 * Expects:
 * - Host normalization recognizes localhost, IPv4, and IPv6 loopback values.
 * - Unsafe bypass keys off explicit localhost host headers.
 * - Forged proxy-only headers do not unlock bypass.
 */

import { isLocalDevHost, isUnsafeLocalRequestAllowed } from "../local-dev-auth";

describe("local-dev-auth", () => {
  test("recognizes loopback host variants including IPv6", () => {
    /* Localhost checks must work for browser, Docker, and IPv6 loopback host spellings. */
    expect(isLocalDevHost("localhost:4173")).toBe(true);
    expect(isLocalDevHost("127.0.0.1:3010")).toBe(true);
    expect(isLocalDevHost("[::1]:4173")).toBe(true);
    expect(isLocalDevHost("::1")).toBe(true);
    expect(isLocalDevHost("example.com")).toBe(false);
  });

  test("allows explicit localhost host headers when unsafe bypass is enabled", () => {
    /* Shared VDS dev keeps PUBLIC_BASE_URL remote, so the actual request host becomes the safe local bypass signal. */
    expect(
      isUnsafeLocalRequestAllowed({
        request: {
          headers: {
            host: "127.0.0.1:4173"
          }
        } as any,
        config: {
          allowUnsafeLocalAuth: true,
          publicBaseUrl: "https://example.com"
        } as any
      })
    ).toBe(true);
  });

  test("ignores forged proxy-only headers when host itself is not local", () => {
    /* Bypass must not activate from a spoofed proxy header if the actual request host stays remote. */
    expect(
      isUnsafeLocalRequestAllowed({
        request: {
          headers: {
            host: "example.com",
            "x-forwarded-host": "127.0.0.1:4173"
          }
        } as any,
        config: {
          allowUnsafeLocalAuth: true,
          publicBaseUrl: "https://example.com"
        } as any
      })
    ).toBe(false);
  });
});
