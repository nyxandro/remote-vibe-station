/**
 * @fileoverview Persistent JSON store for per-project runtime settings.
 *
 * Exports:
 * - ProjectRuntimeSettingsStore - Read/write settings by project slug.
 */

import * as path from "node:path";

import { Injectable } from "@nestjs/common";

import { ProjectRuntimeSettings } from "./project-runtime.types";
import { readJsonFileAsync, writeJsonFileAsyncAtomic } from "../storage/json-file";

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
    /* Runtime settings are authoritative deploy state, so broken JSON must stop the flow explicitly. */
    return readJsonFileAsync({
      filePath: this.filePath,
      label: "runtime settings",
      createEmptyValue: () => ({}),
      normalize: (parsed) => {
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Expected object map");
        }
        return parsed as SettingsStateFile;
      },
      parseErrorStrategy: "throw",
      normalizeErrorStrategy: "throw"
    });
  }

  private async writeAll(state: SettingsStateFile): Promise<void> {
    /* Persist human-readable settings to simplify manual debugging. */
    await writeJsonFileAsyncAtomic(this.filePath, state);
  }
}
