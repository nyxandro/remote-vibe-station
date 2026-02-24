/**
 * @fileoverview Persistent JSON store for per-project runtime settings.
 *
 * Exports:
 * - ProjectRuntimeSettingsStore (L24) - Read/write settings by project slug.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";

import { ProjectRuntimeSettings } from "./project-runtime.types";

const DATA_DIR = "data";
const SETTINGS_FILE = "project-runtime.settings.json";

type SettingsStateFile = Record<string, ProjectRuntimeSettings>;

@Injectable()
export class ProjectRuntimeSettingsStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor() {
    /* Keep settings in backend data volume so deploy config survives restarts. */
    this.filePath = path.join(process.cwd(), DATA_DIR, SETTINGS_FILE);
  }

  public async get(slug: string): Promise<ProjectRuntimeSettings | null> {
    /* Return null when project has no explicit runtime settings yet. */
    await this.writeQueue;
    const state = await this.readAll();
    return state[slug] ?? null;
  }

  public async set(slug: string, settings: ProjectRuntimeSettings): Promise<ProjectRuntimeSettings> {
    /* Serialize read-modify-write to avoid races between concurrent updates. */
    const operation = async (): Promise<void> => {
      const state = await this.readAll();
      state[slug] = settings;
      await this.writeAll(state);
    };

    const queued = this.writeQueue.then(operation, operation);
    this.writeQueue = queued.then(
      () => undefined,
      () => undefined
    );
    await queued;
    return settings;
  }

  private async readAll(): Promise<SettingsStateFile> {
    /* Lazily create data dir and treat missing file as empty state. */
    const directory = path.dirname(this.filePath);
    await fs.promises.mkdir(directory, { recursive: true });

    if (!fs.existsSync(this.filePath)) {
      return {};
    }

    const raw = await fs.promises.readFile(this.filePath, "utf-8");
    try {
      return JSON.parse(raw) as SettingsStateFile;
    } catch (error) {
      throw new Error(`Failed to parse runtime settings JSON at '${this.filePath}': ${String(error)}`);
    }
  }

  private async writeAll(state: SettingsStateFile): Promise<void> {
    /* Persist human-readable settings to simplify manual debugging. */
    await fs.promises.writeFile(this.filePath, JSON.stringify(state, null, 2), "utf-8");
  }
}
