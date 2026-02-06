/**
 * @fileoverview Tests for git summary output parsing helpers.
 */

import { countChangedFilesFromPorcelain, parseNumstatTotals } from "../git-summary-parser";

describe("git summary parser", () => {
  test("counts changed files from porcelain rows", () => {
    /* Porcelain rows include tracked and untracked changes one per line. */
    const raw = [" M src/app.ts", "A  src/new.ts", "?? src/notes.md"].join("\n");
    expect(countChangedFilesFromPorcelain(raw)).toBe(3);
  });

  test("sums additions and deletions from numstat output", () => {
    /* Numeric columns should be aggregated across all files. */
    const raw = ["10\t2\tsrc/app.ts", "3\t0\tsrc/a.ts"].join("\n");
    expect(parseNumstatTotals(raw)).toEqual({ additions: 13, deletions: 2 });
  });

  test("ignores binary numstat markers", () => {
    /* Binary rows use '-' placeholders and should not break aggregation. */
    const raw = "-\t-\tassets/logo.png";
    expect(parseNumstatTotals(raw)).toEqual({ additions: 0, deletions: 0 });
  });
});
