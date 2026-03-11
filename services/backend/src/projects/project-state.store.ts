/**
 * @fileoverview Minimal persistent state for discovered projects.
 *
 * Exports:
 * - ProjectStateStore - Stores runtime status by slug.
 */

import * as path from "node:path";

import { Injectable } from "@nestjs/common";

import { ProjectListItem } from "./project.types";
import { readJsonFileSync, writeJsonFileSyncAtomic } from "../storage/json-file";

const DATA_DIR = "data";
const STATE_FILE = "projects.state.json";

type ProjectState = {
  status?: ProjectListItem["status"];
  lastStartedAt?: string;
};

type StateFile = Record<string, ProjectState>;

@Injectable()
export class ProjectStateStore {
  private readonly filePath: string;

  public constructor() {
    /* Keep state near backend data volume; stable across restarts. */
    this.filePath = path.join(process.cwd(), DATA_DIR, STATE_FILE);
  }

  public get(slug: string): ProjectState {
    /* Read state lazily to keep implementation simple and robust. */
    const file = this.readAll();
    return file[slug] ?? {};
  }

  public set(slug: string, patch: ProjectState): ProjectState {
    /* Upsert state for a given slug. */
    const file = this.readAll();
    const next = { ...(file[slug] ?? {}), ...patch };
    file[slug] = next;
    this.writeAll(file);
    return next;
  }

  public pruneKnownSlugs(input: { allowedSlugs: Set<string> }): { before: number; after: number; removed: number } {
    /*
     * Remove stale entries for projects that no longer exist on disk.
     * This store is derived data and safe to rebuild.
     */
    const file = this.readAll();
    const keys = Object.keys(file);
    const before = keys.length;

    for (const slug of keys) {
      if (!input.allowedSlugs.has(slug)) {
        delete file[slug];
      }
    }

    const after = Object.keys(file).length;
    const removed = before - after;
    if (removed > 0) {
      this.writeAll(file);
    }
    return { before, after, removed };
  }

  private readAll(): StateFile {
    /* Project runtime status is derived data, so malformed JSON should recover instead of blocking the app. */
    return readJsonFileSync({
      filePath: this.filePath,
      label: "projects-state",
      createEmptyValue: () => ({}),
      normalize: (parsed) => {
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return {};
        }

        return parsed as StateFile;
      },
      parseErrorStrategy: "recover",
      normalizeErrorStrategy: "recover"
    });
  }

  private writeAll(file: StateFile): void {
    /* Persist stable, human-readable JSON. */
    writeJsonFileSyncAtomic(this.filePath, file);
  }
}
