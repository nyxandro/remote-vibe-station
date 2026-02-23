/**
 * @fileoverview Project-scoped discovery of environment files.
 *
 * Exports:
 * - EnvFileSummary (L17) - Minimal env-file metadata for UI lists.
 * - discoverProjectEnvFiles (L52) - Bounded recursive scanner with ignore rules.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type EnvFileSummary = {
  name: string;
  relativePath: string;
};

type DiscoverProjectEnvFilesInput = {
  projectRoot: string;
  ignoredDirNames?: string[];
  maxDepth?: number;
  maxResults?: number;
};

const DEFAULT_IGNORED_DIRS = [
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".cache",
  "coverage",
  "vendor"
];

const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_RESULTS = 200;

const isEnvFileName = (name: string): boolean => {
  /*
   * Support common env naming patterns only.
   * This keeps the list focused and avoids matching unrelated files.
   */
  if (name === ".env" || name === ".envrc") {
    return true;
  }
  if (name.startsWith(".env.")) {
    return true;
  }
  if (name.endsWith(".env") || name.includes(".env.")) {
    return true;
  }
  return false;
};

export const discoverProjectEnvFiles = (input: DiscoverProjectEnvFilesInput): EnvFileSummary[] => {
  /*
   * Scan project tree with strict bounds so API stays responsive
   * even for large monorepos.
   */
  const projectRoot = path.resolve(input.projectRoot);
  const ignoredDirNames = new Set(input.ignoredDirNames ?? DEFAULT_IGNORED_DIRS);
  const maxDepth = input.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;

  if (!fs.existsSync(projectRoot)) {
    return [];
  }

  const rootStat = fs.statSync(projectRoot);
  if (!rootStat.isDirectory()) {
    return [];
  }

  const out: EnvFileSummary[] = [];
  const stack: Array<{ absoluteDir: string; depth: number }> = [{ absoluteDir: projectRoot, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop() as { absoluteDir: string; depth: number };
    const entries = fs.readdirSync(current.absoluteDir, { withFileTypes: true });

    for (const entry of entries) {
      /* Stop early when the hard cap is reached. */
      if (out.length >= maxResults) {
        break;
      }

      const absolutePath = path.join(current.absoluteDir, entry.name);

      if (entry.isDirectory()) {
        if (current.depth >= maxDepth) {
          continue;
        }
        if (ignoredDirNames.has(entry.name)) {
          continue;
        }
        stack.push({ absoluteDir: absolutePath, depth: current.depth + 1 });
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!isEnvFileName(entry.name)) {
        continue;
      }

      out.push({
        name: entry.name,
        relativePath: path.relative(projectRoot, absolutePath)
      });
    }

    if (out.length >= maxResults) {
      break;
    }
  }

  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
};
