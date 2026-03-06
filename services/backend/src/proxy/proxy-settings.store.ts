/**
 * @fileoverview Persistent JSON store for global CLI/Proxy preferences.
 *
 * Exports:
 * - ProxySettingsStore - Reads/writes proxy profile in backend data volume.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { ProxySettingsInput, ProxySettingsRecord } from "./proxy-settings.types";

const DATA_DIR = "data";
const SETTINGS_FILE = "proxy.settings.json";
const DEFAULT_NO_PROXY = "localhost,127.0.0.1,backend,opencode,cliproxy";

const storedSchema = z.object({
  mode: z.enum(["direct", "vless"]),
  vlessProxyUrl: z.string().nullable(),
  noProxy: z.string().min(1),
  updatedAt: z.string().min(1)
});

@Injectable()
export class ProxySettingsStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor() {
    /* Keep global proxy profile inside backend data volume for restart safety. */
    this.filePath = path.join(process.cwd(), DATA_DIR, SETTINGS_FILE);
  }

  public async get(): Promise<ProxySettingsRecord> {
    /* Return explicit defaults when file is absent to avoid hidden behavior. */
    await this.writeQueue;
    const saved = await this.readRaw();
    if (!saved) {
      return {
        mode: "direct",
        vlessProxyUrl: null,
        noProxy: DEFAULT_NO_PROXY,
        updatedAt: new Date().toISOString()
      };
    }
    return saved;
  }

  public async set(input: ProxySettingsInput): Promise<ProxySettingsRecord> {
    /* Serialize writes to prevent concurrent update races in single JSON file. */
    const record: ProxySettingsRecord = {
      mode: input.mode,
      vlessProxyUrl: input.vlessProxyUrl,
      noProxy: input.noProxy,
      updatedAt: new Date().toISOString()
    };

    const operation = async (): Promise<void> => {
      await this.writeRaw(record);
    };

    const queued = this.writeQueue.then(operation, operation);
    this.writeQueue = queued.then(
      () => undefined,
      () => undefined
    );
    await queued;
    return record;
  }

  private async readRaw(): Promise<ProxySettingsRecord | null> {
    /* Lazily create directory and treat missing settings file as not configured yet. */
    const directory = path.dirname(this.filePath);
    await fs.promises.mkdir(directory, { recursive: true });

    let raw: string;
    try {
      raw = await fs.promises.readFile(this.filePath, "utf-8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return null;
      }
      throw error;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      return storedSchema.parse(parsed);
    } catch (error) {
      throw new Error(`Failed to parse proxy settings JSON at '${this.filePath}': ${String(error)}`);
    }
  }

  private async writeRaw(record: ProxySettingsRecord): Promise<void> {
    /* Persist human-readable JSON to simplify on-host troubleshooting. */
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.promises.writeFile(this.filePath, JSON.stringify(record, null, 2), "utf-8");
  }
}
