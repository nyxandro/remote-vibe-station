/**
 * @fileoverview File tree and file reading utilities scoped to a project.
 *
 * Exports:
 * - ProjectFilesService (L28) - Lists folders and reads text files safely.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { assertWithinRoot } from "./project-paths";

const DEFAULT_IGNORED_NAMES = [".git", "node_modules", ".next", "dist", "build"];
const MAX_TEXT_BYTES = 256 * 1024;

export type FileEntry = {
  name: string;
  kind: "file" | "dir";
};

@Injectable()
export class ProjectFilesService {
  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {}

  public list(projectRootPath: string, relativePath: string | undefined): FileEntry[] {
    /*
     * Resolve path within the project and list immediate children.
     * We keep it shallow to avoid performance issues and surprising scans.
     */
    const safeRelativePath = relativePath ?? "";
    const abs = path.resolve(projectRootPath, safeRelativePath);

    assertWithinRoot(this.config.projectsRoot, abs);
    assertWithinRoot(projectRootPath, abs);

    const stat = fs.statSync(abs);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${safeRelativePath || "."}`);
    }

    const entries = fs.readdirSync(abs, { withFileTypes: true });
    const ignored = new Set(DEFAULT_IGNORED_NAMES);

    return entries
      .filter((e) => !ignored.has(e.name))
      .map((e): FileEntry => {
        /* Keep literal union type for kind to satisfy TS. */
        const kind: FileEntry["kind"] = e.isDirectory() ? "dir" : "file";
        return { name: e.name, kind };
      })
      .sort((a, b) => {
        /* Directories first, then files, stable by name. */
        if (a.kind !== b.kind) {
          return a.kind === "dir" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
  }

  public readText(projectRootPath: string, relativeFilePath: string): string {
    /*
     * Read a text file with a hard size limit.
     * This endpoint is for UI inspection, not binary downloads.
     */
    const abs = path.resolve(projectRootPath, relativeFilePath);
    assertWithinRoot(this.config.projectsRoot, abs);
    assertWithinRoot(projectRootPath, abs);

    const stat = fs.statSync(abs);
    if (!stat.isFile()) {
      throw new Error(`Not a file: ${relativeFilePath}`);
    }

    if (stat.size > MAX_TEXT_BYTES) {
      throw new Error(`File too large to preview (${stat.size} bytes)`);
    }

    return fs.readFileSync(abs, "utf-8");
  }
}
