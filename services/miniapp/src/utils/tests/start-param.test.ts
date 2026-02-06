// @vitest-environment jsdom

/**
 * @fileoverview Tests for Mini App start parameter parser.
 *
 * Exports:
 * - (none)
 */

import { afterEach, describe, expect, it } from "vitest";

import { readDiffPreviewToken } from "../start-param";

describe("readDiffPreviewToken", () => {
  afterEach(() => {
    /* Restore URL between tests to avoid cross-test leakage. */
    window.history.replaceState({}, "", "/");
    (window as any).Telegram = undefined;
  });

  it("reads token from tgWebAppStartParam query", () => {
    window.history.replaceState({}, "", "/?tgWebAppStartParam=diff_abc123");
    expect(readDiffPreviewToken()).toBe("abc123");
  });

  it("reads token from Telegram initDataUnsafe.start_param", () => {
    (window as any).Telegram = {
      WebApp: {
        initDataUnsafe: {
          start_param: "diff_xyz"
        }
      }
    };
    expect(readDiffPreviewToken()).toBe("xyz");
  });

  it("supports legacy hash diff token fallback", () => {
    window.history.replaceState({}, "", "/#diff=legacy123");
    expect(readDiffPreviewToken()).toBe("legacy123");
  });
});
