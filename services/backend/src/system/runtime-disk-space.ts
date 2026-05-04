/**
 * @fileoverview Disk-space guard for runtime image updates.
 *
 * Exports:
 * - MIN_RUNTIME_UPDATE_FREE_BYTES - Required free bytes before pulling runtime images.
 * - assertRuntimeUpdateDiskSpace - Fails fast when Docker/root filesystem is too full for an update.
 */

import * as fs from "node:fs";

const GIB = 1024 * 1024 * 1024;

export const MIN_RUNTIME_UPDATE_FREE_BYTES = 8 * GIB;

export function assertRuntimeUpdateDiskSpace(pathToCheck: string): void {
  /* Pulling all runtime images includes the large OpenCode image, so fail before corrupting state on ENOSPC. */
  const stats = fs.statfsSync(pathToCheck);
  const availableBytes = stats.bavail * stats.bsize;
  if (availableBytes >= MIN_RUNTIME_UPDATE_FREE_BYTES) {
    return;
  }

  throw new Error(`APP_RUNTIME_DISK_SPACE_LOW: Runtime update requires at least ${formatBytes(MIN_RUNTIME_UPDATE_FREE_BYTES)} free on ${pathToCheck}, but only ${formatBytes(availableBytes)} is available. Remove old Docker images and retry.`);
}

function formatBytes(bytes: number): string {
  /* Human-readable byte values make operator remediation faster in Mini App errors. */
  return `${(bytes / GIB).toFixed(1)}GiB`;
}
