/**
 * @fileoverview Linux host metrics collector for Mini App server diagnostics.
 *
 * Exports:
 * - SystemMetricsSnapshot - Snapshot payload returned to Mini App.
 * - SystemMetricsService - Collects CPU/RAM/disk/network metrics.
 */

import { Inject, Injectable, Optional } from "@nestjs/common";
import { readFile, statfs } from "node:fs/promises";
import * as os from "node:os";

import { AppConfig, ConfigToken } from "../config/config.types";

const NETWORK_LOOPBACK_INTERFACE = "lo";
const PROC_NET_DEV_PATH = "/proc/net/dev";
const BYTES_IN_KIBIBYTE = 1024;
const BYTES_IN_MEBIBYTE = BYTES_IN_KIBIBYTE * 1024;
const BYTES_IN_GIBIBYTE = BYTES_IN_MEBIBYTE * 1024;
const PERCENT_BASE = 100;

type NetworkTotals = {
  interfaces: number;
  rxBytes: number;
  txBytes: number;
};

type CollectorDeps = {
  now: () => number;
  getFsStats: (path: string) => ReturnType<typeof statfs>;
  readProcNetDev: () => Promise<string>;
};

export type SystemMetricsSnapshot = {
  capturedAt: string;
  cpu: {
    cores: number;
    load1: number;
    load5: number;
    load15: number;
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    freePercent: number;
    usedPercent: number;
  };
  disk: {
    rootPath: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    freePercent: number;
    usedPercent: number;
  };
  network: NetworkTotals;
};

@Injectable()
export class SystemMetricsService {
  private readonly deps: CollectorDeps;

  public constructor(
    @Inject(ConfigToken) private readonly config: AppConfig,
    @Optional()
    deps?: Partial<CollectorDeps>
  ) {
    /* Keep IO dependencies overridable so collector can be unit-tested without touching host state. */
    this.deps = {
      now: deps?.now ?? (() => Date.now()),
      getFsStats: deps?.getFsStats ?? ((path: string) => statfs(path)),
      readProcNetDev:
        deps?.readProcNetDev ?? (() => readFile(PROC_NET_DEV_PATH, "utf-8"))
    };
  }

  public static parseProcNetDev(payload: string): NetworkTotals {
    /* Parse cumulative RX/TX bytes from Linux /proc/net/dev format. */
    const lines = payload
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    let interfaces = 0;
    let rxBytes = 0;
    let txBytes = 0;

    /* Skip legend rows and aggregate all non-loopback interfaces. */
    for (const line of lines.slice(2)) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex <= 0) {
        continue;
      }

      const iface = line.slice(0, separatorIndex).trim();
      if (!iface || iface === NETWORK_LOOPBACK_INTERFACE) {
        continue;
      }

      const values = line
        .slice(separatorIndex + 1)
        .trim()
        .split(/\s+/);
      if (values.length < 9) {
        continue;
      }

      const rx = Number(values[0]);
      const tx = Number(values[8]);
      if (!Number.isFinite(rx) || !Number.isFinite(tx)) {
        continue;
      }

      interfaces += 1;
      rxBytes += rx;
      txBytes += tx;
    }

    return { interfaces, rxBytes, txBytes };
  }

  public async getSnapshot(): Promise<SystemMetricsSnapshot> {
    /* Collect host-level resources and return one normalized diagnostics snapshot. */
    const [diskStats, procNetDevPayload] = await Promise.all([
      this.deps.getFsStats(this.config.projectsRoot),
      this.deps.readProcNetDev()
    ]);

    /* CPU load average reflects recent scheduler pressure over 1/5/15 minutes. */
    const [load1, load5, load15] = os.loadavg();
    const cores = os.cpus().length;

    /* Memory fields expose both absolute bytes and percentages for quick UI rendering. */
    const totalMemoryBytes = os.totalmem();
    const freeMemoryBytes = os.freemem();
    const usedMemoryBytes = Math.max(0, totalMemoryBytes - freeMemoryBytes);
    const memoryFreePercent = this.toPercent(freeMemoryBytes, totalMemoryBytes);
    const memoryUsedPercent = this.toPercent(usedMemoryBytes, totalMemoryBytes);

    /* Use available blocks (bavail) so free disk matches writable capacity for the service user. */
    const blockSize = Number(diskStats.bsize);
    const totalBlocks = Number(diskStats.blocks);
    const availableBlocks = Number(diskStats.bavail);
    const diskTotalBytes = Math.max(0, Math.round(blockSize * totalBlocks));
    const diskFreeBytes = Math.max(0, Math.round(blockSize * availableBlocks));
    const diskUsedBytes = Math.max(0, diskTotalBytes - diskFreeBytes);
    const diskFreePercent = this.toPercent(diskFreeBytes, diskTotalBytes);
    const diskUsedPercent = this.toPercent(diskUsedBytes, diskTotalBytes);

    /* Parse cumulative network counters from procfs. */
    const network = SystemMetricsService.parseProcNetDev(procNetDevPayload);

    return {
      capturedAt: new Date(this.deps.now()).toISOString(),
      cpu: {
        cores,
        load1,
        load5,
        load15
      },
      memory: {
        totalBytes: totalMemoryBytes,
        freeBytes: freeMemoryBytes,
        usedBytes: usedMemoryBytes,
        freePercent: memoryFreePercent,
        usedPercent: memoryUsedPercent
      },
      disk: {
        rootPath: this.config.projectsRoot,
        totalBytes: diskTotalBytes,
        freeBytes: diskFreeBytes,
        usedBytes: diskUsedBytes,
        freePercent: diskFreePercent,
        usedPercent: diskUsedPercent
      },
      network
    };
  }

  private toPercent(value: number, total: number): number {
    /* Keep percentage math bounded and rounded for stable UI labels. */
    if (total <= 0) {
      return 0;
    }

    return Number(((value / total) * PERCENT_BASE).toFixed(2));
  }
}

export const ByteUnits = {
  kib: BYTES_IN_KIBIBYTE,
  mib: BYTES_IN_MEBIBYTE,
  gib: BYTES_IN_GIBIBYTE
};
