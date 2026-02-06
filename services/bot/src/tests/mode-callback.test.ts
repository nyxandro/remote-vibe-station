/**
 * @fileoverview Tests for mode menu callback encoding/parsing.
 *
 * Exports:
 * - (none)
 */

import { encodeModeCallback, parseModeCallback } from "../mode-callback";

describe("mode-callback", () => {
  it("encodes and parses structured callback payload", () => {
    const encoded = encodeModeCallback("model", ["opencode", "2", "4"]);
    expect(encoded).toBe("mode|model|opencode|2|4");

    expect(parseModeCallback(encoded)).toEqual({
      action: "model",
      parts: ["opencode", "2", "4"]
    });
  });

  it("rejects non-mode callback data", () => {
    expect(parseModeCallback("noop|x")).toBeNull();
  });
});
