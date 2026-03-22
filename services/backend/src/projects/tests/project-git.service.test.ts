/**
 * @fileoverview Tests for project git summary service.
 *
 * Exports:
 * - none - Jest coverage for repository summary payloads used by project cards.
 */

const execFileAsync = jest.fn();

jest.mock("node:util", () => ({
  promisify: jest.fn(() => execFileAsync)
}));

import { ProjectGitService } from "../project-git.service";

describe("ProjectGitService", () => {
  beforeEach(() => {
    /* Reset mocked git command sequence so each test defines an explicit repository state. */
    execFileAsync.mockReset();
  });

  test("returns current branch together with git delta counters", async () => {
    /* Project cards need branch context in the compact summary row so operators can spot the active ref immediately. */
    execFileAsync
      .mockResolvedValueOnce({ stdout: "true\n" })
      .mockResolvedValueOnce({ stdout: " M src/app.ts\n?? src/new.ts\n" })
      .mockResolvedValueOnce({ stdout: "12\t5\tsrc/app.ts\n1\t0\tsrc/new.ts\n" })
      .mockResolvedValueOnce({ stdout: "3\t1\tsrc/index.ts\n" })
      .mockResolvedValueOnce({ stdout: "feature/ui-branch\n" });

    const service = new ProjectGitService();

    await expect(service.summaryForProjectRoot("/workspace/project")).resolves.toEqual({
      currentBranch: "feature/ui-branch",
      filesChanged: 2,
      additions: 16,
      deletions: 6
    });
  });

  test("returns current branch even when repository has no pending changes", async () => {
    /* Clean repositories should still expose their active branch so project selection stays informative before any edits happen. */
    execFileAsync
      .mockResolvedValueOnce({ stdout: "true\n" })
      .mockResolvedValueOnce({ stdout: "" })
      .mockResolvedValueOnce({ stdout: "" })
      .mockResolvedValueOnce({ stdout: "" })
      .mockResolvedValueOnce({ stdout: "main\n" });

    const service = new ProjectGitService();

    await expect(service.summaryForProjectRoot("/workspace/project")).resolves.toEqual({
      currentBranch: "main",
      filesChanged: 0,
      additions: 0,
      deletions: 0
    });
  });
});
