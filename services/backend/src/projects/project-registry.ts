/**
 * @fileoverview JSON-backed registry for projects.
 *
 * Exports:
 * - DATA_DIR (L18) - Storage folder name.
 * - PROJECTS_FILE (L19) - Registry file name.
 * - ProjectRegistry (L22) - Load, store, and update project records.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import { v4 as uuid } from "uuid";

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
    /* Ensure data directory exists. */
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    /* Return empty list if file is missing. */
    if (!fs.existsSync(this.filePath)) {
      return [];
    }

    /* Read and parse JSON file. */
    const raw = await fs.promises.readFile(this.filePath, "utf-8");
    return JSON.parse(raw) as ProjectRecord[];
  }

  private async writeAll(items: ProjectRecord[]): Promise<void> {
    /* Persist JSON list to disk. */
    const data = JSON.stringify(items, null, 2);
    await fs.promises.writeFile(this.filePath, data, "utf-8");
  }
}
