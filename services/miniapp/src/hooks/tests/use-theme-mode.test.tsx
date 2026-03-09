/**
 * @fileoverview Tests for shared theme mode hook behavior.
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useThemeMode } from "../use-theme-mode";
import { THEME_STORAGE_KEY } from "../../utils/theme";

describe("useThemeMode", () => {
  afterEach(() => {
    /* Reset persisted theme side effects between hook runs. */
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  it("applies stored theme on mount and persists updates", () => {
    /* Standalone kanban and workspace should share one remembered theme selection. */
    localStorage.setItem(THEME_STORAGE_KEY, "dark");

    const { result } = renderHook(() => useThemeMode());

    expect(result.current.themeMode).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    act(() => {
      result.current.setThemeMode("light");
    });

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
