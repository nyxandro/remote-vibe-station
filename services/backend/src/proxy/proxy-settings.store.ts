/**
 * @fileoverview Persistent JSON store for global CLI/Proxy preferences.
 *
 * Exports:
 * - ProxySettingsStore - Reads/writes proxy profile in backend data volume.
 */

import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { ProxySettingsInput, ProxySettingsRecord } from "./proxy-settings.types";
import { readJsonFileAsync, writeJsonFileAsyncAtomic } from "../storage/json-file";

const DATA_DIR = "data";
const SETTINGS_FILE = "proxy.settings.json";
const DEFAULT_NO_PROXY = "localhost,127.0.0.1,backend,bot,miniapp,opencode,cliproxy,proxy,vless-proxy";
const DEFAULT_ENABLED_SERVICES = ["bot", "cliproxy", "opencode"] as const;

const buildStoredNoProxy = (enabledServices: readonly string[]): string => {
  /* Persisted NO_PROXY should stay derived from selected outbound services plus required local hostnames. */
  return [...new Set([...DEFAULT_NO_PROXY.split(","), ...enabledServices])].sort().join(",");
};

const storedSchema = z.object({
  mode: z.enum(["direct", "vless"]),
  vlessProxyUrl: z.string().nullable(),
  /* Existing persisted files may not have the new URL/service fields yet, so migrate them explicitly. */
  vlessConfigUrl: z.string().nullable().optional().default(null),
  enabledServices: z.array(z.enum(["bot", "opencode", "cliproxy"])).optional().default([...DEFAULT_ENABLED_SERVICES]),
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
          vlessConfigUrl: null,
          enabledServices: [...DEFAULT_ENABLED_SERVICES],
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
      vlessConfigUrl: input.vlessConfigUrl,
      enabledServices: [...input.enabledServices],
      /* Persist derived NO_PROXY so runtime troubleshooting can inspect the exact exported host exclusions. */
      noProxy: buildStoredNoProxy(input.enabledServices),
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
    /* Proxy settings are explicit operator input, so malformed JSON must fail fast. */
    const emptySentinel = Symbol("proxy-settings-empty");
    const loaded = await readJsonFileAsync<ProxySettingsRecord | typeof emptySentinel>({
      filePath: this.filePath,
      label: "proxy settings",
      createEmptyValue: () => emptySentinel,
      normalize: (parsed) => storedSchema.parse(parsed),
      parseErrorStrategy: "throw",
      normalizeErrorStrategy: "throw"
    });

    return loaded === emptySentinel ? null : loaded;
  }

  private async writeRaw(record: ProxySettingsRecord): Promise<void> {
    /* Persist human-readable JSON to simplify on-host troubleshooting. */
    await writeJsonFileAsyncAtomic(this.filePath, record);
  }
}
