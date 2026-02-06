/**
 * @fileoverview Project discovery by scanning PROJECTS_ROOT.
 *
 * Exports:
 * - DEFAULT_COMPOSE_FILENAMES (L21) - Supported compose filenames.
 * - discoverProjects (L32) - Scan immediate subfolders and describe projects.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { ProjectListItem } from "./project.types";

const DEFAULT_COMPOSE_FILENAMES = [
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml"
];

type DiscoverOptions = {
  projectsRoot: string;
  /** Optional: filter out hidden or special folders. */
  ignoreFolderNames?: string[];
};

export const discoverProjects = (options: DiscoverOptions): ProjectListItem[] => {
  /* Read immediate children to keep discovery cheap and predictable. */
  const rootEntries = fs.readdirSync(options.projectsRoot, { withFileTypes: true });
  const ignore = new Set(options.ignoreFolderNames ?? []);

  /* Build items in a loop to keep types strict (no nullable arrays). */
  const items: ProjectListItem[] = [];

  for (const entry of rootEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    /* Treat folder name as the project slug/id (stable). */
    const slug = entry.name;
    if (ignore.has(slug)) {
      continue;
    }

    const rootPath = path.join(options.projectsRoot, slug);

    /* Detect compose file existence (any supported filename). */
    const composePath = DEFAULT_COMPOSE_FILENAMES
      .map((name) => path.join(rootPath, name))
      .find((candidate) => fs.existsSync(candidate));

    /* Detect our optional per-project config. */
    const configPath = path.join(rootPath, "opencode.project.json");
    const configured = fs.existsSync(configPath);

    /*
     * We never guess how to run a project.
     * - If a compose file exists, we can run basic lifecycle commands.
     * - If only a folder exists, it is discovered but not runnable.
     */
    const hasCompose = Boolean(composePath);
    const runnable = hasCompose;

    items.push({
      id: slug,
      slug,
      name: slug,
      rootPath,
      hasCompose,
      configured,
      runnable,
      status: "unknown"
    });
  }

  return items.sort((a, b) => a.slug.localeCompare(b.slug));
};

export { DEFAULT_COMPOSE_FILENAMES };
