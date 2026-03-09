/**
 * @fileoverview Shared React wrapper around Mini App theme persistence.
 *
 * Exports:
 * - useThemeMode - Reads stored theme, applies it to the document, and persists changes.
 */

import { useEffect, useState } from "react";

import { applyThemeToDocument, readStoredThemeMode, ThemeMode } from "../utils/theme";

export const useThemeMode = () => {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readStoredThemeMode());

  useEffect(() => {
    /* Keep html[data-theme] synchronized for both workspace and standalone kanban routes. */
    applyThemeToDocument(themeMode);
  }, [themeMode]);

  return {
    themeMode,
    setThemeMode
  };
};
