/**
 * @fileoverview Git operations service used by Mini App GitHub tab.
 *
 * Exports:
 * - ProjectGitOpsService (L28) - Reads repository overview and executes core git actions.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Injectable } from "@nestjs/common";

import { parseGitPorcelainStatus } from "./git-overview-parser";
import { ProjectGitFileEntry, ProjectGitOverview } from "./project.types";

const GIT_EXEC_TIMEOUT_MS = 20_000;
const execFileAsync = promisify(execFile);

@Injectable()
export class ProjectGitOpsService {
  public async getOverview(rootPath: string): Promise<ProjectGitOverview | null> {
    /* Return null for non-git directories to keep UI clean. */
    if (!(await this.isGitRepository(rootPath))) {
      return null;
    }

    const [currentBranchRaw, branchesRaw, porcelainRaw, unstagedRaw, stagedRaw, upstreamRaw] =
      await Promise.all([
        this.runGitCommand(["branch", "--show-current"], rootPath),
        this.runGitCommand(["branch", "--format=%(refname:short)"], rootPath),
        this.runGitCommand(["status", "--porcelain"], rootPath),
        this.runGitCommand(["diff", "--numstat"], rootPath),
        this.runGitCommand(["diff", "--cached", "--numstat"], rootPath),
        this.runGitCommand(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], rootPath, true)
      ]);

    const files = this.buildFileEntries(porcelainRaw, unstagedRaw, stagedRaw);
    const [behind, ahead] = this.parseUpstreamCounts(upstreamRaw);
    return {
      currentBranch: currentBranchRaw.trim() || "HEAD",
      branches: branchesRaw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
      ahead,
      behind,
      files
    };
  }

  public async checkoutBranch(rootPath: string, branch: string): Promise<void> {
    /* Switch active branch for the selected project repository. */
    await this.runGitCommand(["switch", branch], rootPath);
  }

  public async fetchAll(rootPath: string): Promise<void> {
    /* Fetch remote references before pull/merge flows. */
    await this.runGitCommand(["fetch", "--all", "--prune"], rootPath);
  }

  public async pull(rootPath: string): Promise<void> {
    /* Prefer ff-only pull for predictable history in operator UI. */
    await this.runGitCommand(["pull", "--ff-only"], rootPath);
  }

  public async push(rootPath: string): Promise<void> {
    /* Push current branch to configured upstream. */
    await this.runGitCommand(["push"], rootPath);
  }

  public async merge(rootPath: string, sourceBranch: string): Promise<void> {
    /* Merge source branch into currently checked-out branch. */
    await this.runGitCommand(["merge", sourceBranch], rootPath);
  }

  public async commitAll(rootPath: string, message: string): Promise<void> {
    /* Commit all tracked/untracked changes as one explicit user action. */
    await this.runGitCommand(["add", "-A"], rootPath);
    await this.runGitCommand(["commit", "-m", message], rootPath);
  }

  private buildFileEntries(
    porcelainRaw: string,
    unstagedNumstatRaw: string,
    stagedNumstatRaw: string
  ): ProjectGitFileEntry[] {
    /* Merge status codes and line counters into one file-oriented payload. */
    const parsed = parseGitPorcelainStatus(porcelainRaw);
    const byPath = new Map<string, ProjectGitFileEntry>();

    for (const file of parsed) {
      byPath.set(file.path, {
        path: file.path,
        status: file.status,
        additions: 0,
        deletions: 0
      });
    }

    this.applyNumstat(byPath, unstagedNumstatRaw);
    this.applyNumstat(byPath, stagedNumstatRaw);

    return Array.from(byPath.values()).sort((left, right) => left.path.localeCompare(right.path));
  }

  private applyNumstat(target: Map<string, ProjectGitFileEntry>, raw: string): void {
    /* Numstat rows enrich file entries with line delta counters. */
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const [addRaw, delRaw, ...pathParts] = trimmed.split(/\s+/);
      const path = pathParts.join(" ");
      if (!path) {
        continue;
      }

      const additions = Number.parseInt(addRaw, 10);
      const deletions = Number.parseInt(delRaw, 10);
      const existing = target.get(path) ?? {
        path,
        status: "modified" as const,
        additions: 0,
        deletions: 0
      };
      existing.additions += Number.isFinite(additions) ? additions : 0;
      existing.deletions += Number.isFinite(deletions) ? deletions : 0;
      target.set(path, existing);
    }
  }

  private parseUpstreamCounts(raw: string): [number, number] {
    /* Parse `behind ahead` counts returned by rev-list helper. */
    const [behindRaw, aheadRaw] = raw.trim().split(/\s+/);
    const behind = Number.parseInt(behindRaw ?? "0", 10);
    const ahead = Number.parseInt(aheadRaw ?? "0", 10);
    return [Number.isFinite(behind) ? behind : 0, Number.isFinite(ahead) ? ahead : 0];
  }

  private async isGitRepository(cwd: string): Promise<boolean> {
    /* Fast repository check used by overview endpoint. */
    try {
      const output = await this.runGitCommand(["rev-parse", "--is-inside-work-tree"], cwd);
      return output.trim() === "true";
    } catch {
      return false;
    }
  }

  private async runGitCommand(args: string[], cwd: string, allowFailure = false): Promise<string> {
    /*
     * Execute git command with local safe.directory override.
     * `allowFailure` is used for optional upstream metadata when branch tracking is absent.
     */
    try {
      const result = await execFileAsync("git", ["-c", `safe.directory=${cwd}`, ...args], {
        cwd,
        timeout: GIT_EXEC_TIMEOUT_MS,
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024
      });
      return [result.stdout ?? "", result.stderr ?? ""].join("");
    } catch (error) {
      if (allowFailure) {
        return "";
      }
      throw error;
    }
  }
}
