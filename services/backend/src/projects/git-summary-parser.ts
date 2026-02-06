/**
 * @fileoverview Parsing helpers for git status and numstat output.
 *
 * Exports:
 * - GitLineStats (L10) - Aggregated line counters.
 * - countChangedFilesFromPorcelain (L16) - Counts changed files from `git status --porcelain`.
 * - parseNumstatTotals (L24) - Sums additions/deletions from `git diff --numstat` output.
 */

export type GitLineStats = {
  additions: number;
  deletions: number;
};

export const countChangedFilesFromPorcelain = (raw: string): number => {
  /* Each non-empty porcelain line corresponds to one changed path entry. */
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0).length;
};

export const parseNumstatTotals = (raw: string): GitLineStats => {
  /*
   * `git diff --numstat` rows look like: `<additions> <deletions> <path>`.
   * Binary files may contain `-` instead of numbers; we treat them as 0 line deltas.
   */
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .reduce<GitLineStats>(
      (acc, line) => {
        const [addToken, delToken] = line.split(/\s+/);
        const add = Number.parseInt(addToken, 10);
        const del = Number.parseInt(delToken, 10);
        return {
          additions: acc.additions + (Number.isFinite(add) ? add : 0),
          deletions: acc.deletions + (Number.isFinite(del) ? del : 0)
        };
      },
      { additions: 0, deletions: 0 }
    );
};
