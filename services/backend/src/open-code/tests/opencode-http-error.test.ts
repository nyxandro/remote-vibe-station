/**
 * @fileoverview Tests for OpenCode HTTP error normalization.
 *
 * Exports:
 * - (none)
 */

import { formatOpenCodeHttpError } from "../opencode-http-error";

describe("formatOpenCodeHttpError", () => {
  it("extracts nested provider error message and retry-after header", () => {
    /* Provider 429 payload should become actionable Telegram-friendly text. */
    const result = formatOpenCodeHttpError({
      status: 429,
      bodyText: JSON.stringify({ error: { message: "Rate limit exceeded" } }),
      retryAfterHeader: "12"
    });

    expect(result).toBe("Rate limit exceeded. Повтор через 12 сек.");
  });

  it("prefers JSON retry fields over header when both are present", () => {
    /* OpenCode body hint is usually more specific than edge-proxy retry header. */
    const result = formatOpenCodeHttpError({
      status: 429,
      bodyText: JSON.stringify({ message: "Too many requests", retryAfterSec: 5 }),
      retryAfterHeader: "30"
    });

    expect(result).toBe("Too many requests. Повтор через 5 сек.");
  });

  it("falls back to generic status message when payload is empty", () => {
    /* Empty error body should still produce deterministic user-visible context. */
    const result = formatOpenCodeHttpError({
      status: 503,
      bodyText: "",
      retryAfterHeader: null
    });

    expect(result).toBe("OpenCode request failed: 503");
  });
});
