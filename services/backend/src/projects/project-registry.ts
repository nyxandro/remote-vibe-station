/**
 * @fileoverview JSON-backed registry for projects.
 *
 * Exports:
 * - DATA_DIR - Storage folder name.
 * - PROJECTS_FILE - Registry file name.
 * - ProjectRegistry - Load, store, and update project records.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import { v4 as uuid } from "uuid";

import { readJsonFileAsync, writeJsonFileAsyncAtomic } from "../storage/json-file";
import { ProjectCreateRequest, ProjectRecord } from "./project.types";
import { assertWithinRoot } from "./project-paths";

const DATA_DIR = "data";
const PROJECTS_FILE = "projects.json";

@Injectable()
export class ProjectRegistry {
  private readonly filePath: string;

  public constructor() {
    /* Build storage path relative to current working directory. */
    this.filePath = path.join(process.cwd(), DATA_DIR, PROJECTS_FILE);
  }

  public async list(): Promise<ProjectRecord[]> {
    /* Load project list from JSON file. */
    return this.readAll();
  }

  public async create(input: ProjectCreateRequest, domain: string): Promise<ProjectRecord> {
    /* Compose project record from input. */
    const record: ProjectRecord = {
      id: uuid(),
      name: input.name,
      slug: input.slug,
      rootPath: input.rootPath,
      composePath: input.composePath,
      serviceName: input.serviceName,
      servicePort: input.servicePort,
      domain,
      status: "unknown"
    };

    /* Persist record to storage. */
    const items = await this.readAll();
    items.push(record);
    await this.writeAll(items);

    return record;
  }

  public async getById(id: string): Promise<ProjectRecord | null> {
    /* Find project by id. */
    const items = await this.readAll();
    return items.find((item) => item.id === id) ?? null;
  }

  public async updateStatus(
    id: string,
    status: ProjectRecord["status"],
    lastStartedAt?: string
  ): Promise<ProjectRecord> {
    /* Update status fields for a project. */
    const items = await this.readAll();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) {
      throw new Error(`Project not found: ${id}`);
    }

    items[index] = {
      ...items[index],
      status,
      lastStartedAt
    };

    await this.writeAll(items);
    return items[index];
  }

  public async pruneMissingRoots(input: { projectsRoot: string }): Promise<{ before: number; after: number; removed: number }> {
    /*
     * Remove registry records that point to missing or invalid paths.
     * This prevents `projects.json` from accumulating stale entries.
     */
    const items = await this.readAll();
    const before = items.length;

    const kept: ProjectRecord[] = [];
    for (const item of items) {
      /* Drop records with paths outside configured root. */
      try {
        assertWithinRoot(input.projectsRoot, item.rootPath);
        assertWithinRoot(input.projectsRoot, item.composePath);
      } catch {
        continue;
      }

      /* Drop records for deleted projects. */
      if (!fs.existsSync(item.rootPath)) {
        continue;
      }

      kept.push(item);
    }

    const after = kept.length;
    const removed = before - after;
    if (removed > 0) {
      await this.writeAll(kept);
    }
    return { before, after, removed };
  }

  private async readAll(): Promise<ProjectRecord[]> {
    /* Project registry is authoritative state, so broken JSON must fail fast with context. */
    return readJsonFileAsync({
      filePath: this.filePath,
      label: "project registry",
      createEmptyValue: () => [],
      normalize: (parsed) => {
        if (!Array.isArray(parsed)) {
          throw new Error("Expected array of project records");
        }
        return parsed as ProjectRecord[];
      },
      parseErrorStrategy: "throw",
      normalizeErrorStrategy: "throw"
    });
  }

  private async writeAll(items: ProjectRecord[]): Promise<void> {
    /* Persist JSON list to disk. */
    await writeJsonFileAsyncAtomic(this.filePath, items);
  }
}
