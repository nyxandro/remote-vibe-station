/**
 * @fileoverview Git helpers for project-level uncommitted change summaries.
 *
 * Exports:
 * - ProjectGitService (L25) - Collects file/line deltas from local git repositories.
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
     * Return uncommitted git stats for project cards.
     * If folder is not a git repository or has no changes, return null.
     */
    if (!(await this.isGitRepository(rootPath))) {
      return null;
    }

    const [porcelain, unstagedNumstat, stagedNumstat] = await Promise.all([
      this.runGitCommand(["status", "--porcelain"], rootPath),
      this.runGitCommand(["diff", "--numstat"], rootPath),
      this.runGitCommand(["diff", "--cached", "--numstat"], rootPath)
    ]);

    const filesChanged = countChangedFilesFromPorcelain(porcelain);
    if (filesChanged === 0) {
      return null;
    }

    const unstaged = parseNumstatTotals(unstagedNumstat);
    const staged = parseNumstatTotals(stagedNumstat);
    return {
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
