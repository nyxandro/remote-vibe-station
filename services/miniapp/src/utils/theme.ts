/**
 * @fileoverview Theme mode helpers for Mini App UI.
 *
 * Exports:
 * - ThemeMode (L10) - Supported theme identifiers.
 * - THEME_STORAGE_KEY (L12) - localStorage key for persisted theme mode.
 * - normalizeThemeMode (L14) - Normalizes unknown values to light mode.
 * - readStoredThemeMode (L23) - Reads persisted theme with dark-by-default fallback.
 * - applyThemeToDocument (L32) - Applies and persists mode to `<html data-theme>`.
 */

export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "tvoc.miniapp.theme";

export const normalizeThemeMode = (value: string | null | undefined): ThemeMode => {
  /* Keep deterministic fallback: unsupported values always map to light mode. */
  return value === "dark" ? "dark" : "light";
};

export const readStoredThemeMode = (): ThemeMode => {
  /* Read persisted mode from storage in browser-only contexts. */
  if (typeof window === "undefined" || !window.localStorage) {
    return "dark";
  }

  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === null) {
    return "dark";
  }
  return normalizeThemeMode(stored);
};

export const applyThemeToDocument = (mode: ThemeMode): void => {
  /* Use one canonical source of truth for CSS theme selectors. */
  if (typeof window === "undefined" || typeof document === "undefined" || !window.localStorage) {
    return;
  }

  const normalized = normalizeThemeMode(mode);
  document.documentElement.setAttribute("data-theme", normalized);
  localStorage.setItem(THEME_STORAGE_KEY, normalized);
};
