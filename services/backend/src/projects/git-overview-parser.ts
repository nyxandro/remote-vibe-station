/**
 * @fileoverview Parser for `git status --porcelain` file state codes.
 *
 * Exports:
 * - GitPorcelainFile (L12) - Parsed path + normalized status.
 * - parseGitPorcelainStatus (L20) - Converts porcelain rows into UI-friendly statuses.
 */

import { ProjectGitFileStatus } from "./project.types";

export type GitPorcelainFile = {
  path: string;
  status: ProjectGitFileStatus;
};

const CONFLICT_MARKERS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export const parseGitPorcelainStatus = (raw: string): GitPorcelainFile[] => {
  /*
   * Porcelain v1 rows are `<XY> <path>` or `<XY> <old> -> <new>` for renames.
   * We map staged/unstaged code pairs to one normalized status for compact UI badges.
   */
  return raw
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length >= 4)
    .map((line) => {
      const code = line.slice(0, 2);
      const pathRaw = line.slice(3).trim();
      const path = pathRaw.includes(" -> ") ? pathRaw.split(" -> ").at(-1) ?? pathRaw : pathRaw;
      return {
        path,
        status: mapCodeToStatus(code)
      };
    });
};

const mapCodeToStatus = (code: string): ProjectGitFileStatus => {
  /* Keep precedence deterministic for mixed XY states. */
  if (CONFLICT_MARKERS.has(code)) {
    return "conflict";
  }
  if (code === "??") {
    return "untracked";
  }
  if (code.includes("R")) {
    return "renamed";
  }
  if (code.includes("D")) {
    return "deleted";
  }
  if (code.includes("A")) {
    return "added";
  }
  return "modified";
};
