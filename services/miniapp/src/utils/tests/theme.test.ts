// @vitest-environment jsdom

/**
 * @fileoverview Tests for Mini App theme helpers.
 *
 * Exports:
 * - (none)
 */

import { afterEach, describe, expect, it } from "vitest";

import { applyThemeToDocument, normalizeThemeMode, THEME_STORAGE_KEY } from "../theme";

describe("theme utils", () => {
  afterEach(() => {
    /* Clean test side effects to keep theme tests isolated. */
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  it("normalizes unsupported theme values to light mode", () => {
    expect(normalizeThemeMode("solarized")).toBe("light");
  });

  it("writes selected theme to document and localStorage", () => {
    applyThemeToDocument("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });
});
