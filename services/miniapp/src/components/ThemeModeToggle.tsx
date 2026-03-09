/**
 * @fileoverview Shared light/dark theme switcher for Mini App surfaces.
 *
 * Exports:
 * - ThemeModeToggle - Compact toggle that switches and highlights the active theme mode.
 */

import { MoonStar, Sun } from "lucide-react";

import { ThemeMode } from "../utils/theme";

type Props = {
  themeMode: ThemeMode;
  onChangeTheme: (mode: ThemeMode) => void;
  compact?: boolean;
};

export const ThemeModeToggle = (props: Props) => {
  const rootClassName = props.compact ? "theme-mode-toggle theme-mode-toggle-compact" : "theme-mode-toggle";

  return (
    <div className={rootClassName} role="group" aria-label="Theme mode">
      <button
        className={props.themeMode === "light" ? "btn outline active" : "btn outline"}
        onClick={() => props.onChangeTheme("light")}
        type="button"
      >
        <Sun size={16} className="btn-icon" /> Day
      </button>

      <button
        className={props.themeMode === "dark" ? "btn outline active" : "btn outline"}
        onClick={() => props.onChangeTheme("dark")}
        type="button"
      >
        <MoonStar size={16} className="btn-icon" /> Night
      </button>
    </div>
  );
};
