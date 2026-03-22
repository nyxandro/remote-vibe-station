/**
 * @fileoverview Git helpers for project-level branch and change summaries.
 *
 * Exports:
 * - ProjectGitService - Collects active branch plus file/line deltas from local git repositories.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Injectable } from "@nestjs/common";

import { ProjectGitSummary } from "./project.types";
import { countChangedFilesFromPorcelain, parseNumstatTotals } from "./git-summary-parser";

const GIT_EXEC_TIMEOUT_MS = 10_000;
const execFileAsync = promisify(execFile);

@Injectable()
export class ProjectGitService {
  public async summaryForProjectRoot(rootPath: string): Promise<ProjectGitSummary | null> {
    /*
     * Return branch-aware git stats for project cards.
     * Only non-git folders return null because clean repositories should still expose their active branch.
     */
    if (!(await this.isGitRepository(rootPath))) {
      return null;
    }

    const [porcelain, unstagedNumstat, stagedNumstat, currentBranchRaw] = await Promise.all([
      this.runGitCommand(["status", "--porcelain"], rootPath),
      this.runGitCommand(["diff", "--numstat"], rootPath),
      this.runGitCommand(["diff", "--cached", "--numstat"], rootPath),
      this.runGitCommand(["branch", "--show-current"], rootPath)
    ]);

    const filesChanged = countChangedFilesFromPorcelain(porcelain);
    const unstaged = parseNumstatTotals(unstagedNumstat);
    const staged = parseNumstatTotals(stagedNumstat);
    return {
      currentBranch: currentBranchRaw.trim() || "HEAD",
      filesChanged,
      additions: unstaged.additions + staged.additions,
      deletions: unstaged.deletions + staged.deletions
    };
  }

  private async isGitRepository(cwd: string): Promise<boolean> {
    /* Fast git check to avoid throwing noisy errors for plain folders. */
    try {
      const output = await this.runGitCommand(["rev-parse", "--is-inside-work-tree"], cwd);
      return output.trim() === "true";
    } catch {
      return false;
    }
  }

  private async runGitCommand(args: string[], cwd: string): Promise<string> {
    /*
     * Keep git execution centralized with timeout and UTF-8 output handling.
     * `safe.directory` is set inline to avoid global git config mutations in containers.
     */
    const result = await execFileAsync("git", ["-c", `safe.directory=${cwd}`, ...args], {
      cwd,
      timeout: GIT_EXEC_TIMEOUT_MS,
      encoding: "utf8",
      maxBuffer: 1024 * 1024
    });
    return result.stdout ?? "";
  }
}
