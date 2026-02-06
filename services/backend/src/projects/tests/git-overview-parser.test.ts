/**
 * @fileoverview Tests for git status porcelain parsing.
 */

import { parseGitPorcelainStatus } from "../git-overview-parser";

describe("parseGitPorcelainStatus", () => {
  test("maps porcelain codes to normalized file statuses", () => {
    /* Preserve high-level status kinds for Mini App filtering chips. */
    const raw = [
      " M src/app.ts",
      "A  src/new.ts",
      "D  src/old.ts",
      "R  src/a.ts -> src/b.ts",
      "?? src/untracked.ts"
    ].join("\n");

    expect(parseGitPorcelainStatus(raw)).toEqual([
      { path: "src/app.ts", status: "modified" },
      { path: "src/new.ts", status: "added" },
      { path: "src/old.ts", status: "deleted" },
      { path: "src/b.ts", status: "renamed" },
      { path: "src/untracked.ts", status: "untracked" }
    ]);
  });
});
