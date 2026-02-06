/**
 * @fileoverview Tests for project workspace helper utilities.
 */

import {
  deriveFolderNameFromRepositoryUrl,
  isLikelyGitUrl,
  normalizeProjectFolderName
} from "../project-workspace.utils";

describe("project workspace utils", () => {
  test("derives folder name from https repo url", () => {
    /* .git suffix should be removed from folder candidate. */
    expect(deriveFolderNameFromRepositoryUrl("https://github.com/acme/my-app.git")).toBe("my-app");
  });

  test("normalizes and validates project folder names", () => {
    /* Allow docker/project-friendly characters only. */
    expect(normalizeProjectFolderName("  my.app_01  ")).toBe("my.app_01");
    expect(() => normalizeProjectFolderName("../bad")).toThrow();
  });

  test("recognizes common git clone url formats", () => {
    /* Support https and ssh forms used by GitHub users. */
    expect(isLikelyGitUrl("https://github.com/acme/repo.git")).toBe(true);
    expect(isLikelyGitUrl("git@github.com:acme/repo.git")).toBe(true);
    expect(isLikelyGitUrl("ftp://example.com/repo")).toBe(false);
  });
});
