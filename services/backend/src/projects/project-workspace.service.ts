/**
 * @fileoverview Workspace-level project folder management (create/clone/delete).
 *
 * Exports:
 * - ProjectWorkspaceService (L26) - Handles local project directories under PROJECTS_ROOT.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { assertWithinRoot } from "./project-paths";
import {
  deriveFolderNameFromRepositoryUrl,
  isLikelyGitUrl,
  normalizeProjectFolderName
} from "./project-workspace.utils";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 120_000;

@Injectable()
export class ProjectWorkspaceService {
  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {}

  public createProjectFolder(name: string): { slug: string; rootPath: string } {
    /* Create an empty project folder inside PROJECTS_ROOT. */
    const slug = normalizeProjectFolderName(name);
    const rootPath = this.resolveTargetPath(slug);
    if (fs.existsSync(rootPath)) {
      throw new Error(`Project folder already exists: ${slug}`);
    }
    fs.mkdirSync(rootPath, { recursive: false });
    return { slug, rootPath };
  }

  public async cloneRepository(input: {
    repositoryUrl: string;
    folderName?: string;
  }): Promise<{ slug: string; rootPath: string }> {
    /* Clone git repository into PROJECTS_ROOT with optional custom folder name. */
    const repositoryUrl = input.repositoryUrl.trim();
    if (!isLikelyGitUrl(repositoryUrl)) {
      throw new Error("Repository URL must be HTTPS or SSH git URL");
    }

    const folderName = input.folderName?.trim()
      ? normalizeProjectFolderName(input.folderName)
      : deriveFolderNameFromRepositoryUrl(repositoryUrl);

    const rootPath = this.resolveTargetPath(folderName);
    if (fs.existsSync(rootPath)) {
      throw new Error(`Project folder already exists: ${folderName}`);
    }

    try {
      await this.runGitCommand(["clone", repositoryUrl, rootPath], this.config.projectsRoot);
    } catch (error) {
      const details = error instanceof Error ? error.message : "Unknown git clone error";
      throw new Error(
        `Git clone failed. Ensure repository URL is valid and git credentials are configured in backend runtime. ${details}`
      );
    }

    return { slug: folderName, rootPath };
  }

  public async deleteProjectFolder(slug: string): Promise<{ deleted: boolean; rootPath: string }> {
    /* Delete project folder if repository is clean (or non-git). */
    const normalizedSlug = normalizeProjectFolderName(slug);
    const rootPath = this.resolveTargetPath(normalizedSlug);
    if (!fs.existsSync(rootPath)) {
      throw new Error(`Project folder not found: ${normalizedSlug}`);
    }

    if (await this.isGitRepository(rootPath)) {
      const dirty = await this.runGitCommand(["status", "--porcelain"], rootPath);
      if (dirty.trim().length > 0) {
        throw new Error("Cannot delete project: git repository has uncommitted changes");
      }
    }

    fs.rmSync(rootPath, { recursive: true, force: false });
    return { deleted: true, rootPath };
  }

  private resolveTargetPath(folderName: string): string {
    /* Resolve and validate target path under PROJECTS_ROOT. */
    const rootPath = path.resolve(this.config.projectsRoot, folderName);
    assertWithinRoot(this.config.projectsRoot, rootPath);
    return rootPath;
  }

  private async isGitRepository(cwd: string): Promise<boolean> {
    /* Fast git repository check for delete safety guard. */
    try {
      const output = await this.runGitCommand(["rev-parse", "--is-inside-work-tree"], cwd);
      return output.trim() === "true";
    } catch {
      return false;
    }
  }

  private async runGitCommand(args: string[], cwd: string): Promise<string> {
    /* Execute git with local safe.directory override for Docker-mounted repos. */
    const result = await execFileAsync("git", ["-c", `safe.directory=${cwd}`, ...args], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024
    });
    return `${result.stdout ?? ""}${result.stderr ?? ""}`;
  }
}
