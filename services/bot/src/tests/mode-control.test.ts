/**
 * @fileoverview Tests for mode button label rendering.
 *
 * Exports:
 * - (none)
 */

import { MODE_BUTTON_TEXT, buildModeButtonText } from "../mode-control";

describe("buildModeButtonText", () => {
  it("keeps default label when active project is absent", () => {
    expect(buildModeButtonText(null)).toBe(MODE_BUTTON_TEXT);
    expect(buildModeButtonText("   ")).toBe(MODE_BUTTON_TEXT);
  });

  it("renders active project suffix after separator", () => {
    expect(buildModeButtonText("aihub")).toBe("⚙️ Режим | aihub");
  });
});
