/**
 * @fileoverview Persisted latest-release cache for runtime self-updates.
 *
 * Exports:
 * - RUNTIME_LATEST_RELEASE_CACHE_TTL_MS - One-day cache TTL for GitHub release checks.
 * - RuntimeLatestReleaseCache - Persisted latest release metadata with check timestamp.
 * - readFreshRuntimeLatestReleaseCache - Reads cache only when it is valid and fresh.
 * - writeRuntimeLatestReleaseCache - Persists latest release metadata after a network check.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { LatestRuntimeVersion } from "./runtime-github-release";

const RUNTIME_LATEST_RELEASE_CACHE_FILE = "runtime-latest-release-cache.json";
const DAY_MS = 24 * 60 * 60 * 1000;

export const RUNTIME_LATEST_RELEASE_CACHE_TTL_MS = DAY_MS;

export type RuntimeLatestReleaseCache = Required<Pick<LatestRuntimeVersion, "version" | "imageTag">> & {
  commitSha: string | null;
  releaseNotes: string | null;
  checkedAt: string;
};

export function readFreshRuntimeLatestReleaseCache(runtimeDir: string, now: number): RuntimeLatestReleaseCache | null {
  /* Cache is an optimization, so missing or malformed files should fall through to a fresh network check. */
  const cachePath = path.join(runtimeDir, RUNTIME_LATEST_RELEASE_CACHE_FILE);
  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as Partial<RuntimeLatestReleaseCache>;
    const checkedAtMs = typeof parsed.checkedAt === "string" ? Date.parse(parsed.checkedAt) : Number.NaN;
    const ageMs = now - checkedAtMs;
    if (!isValidCacheShape(parsed) || !Number.isFinite(checkedAtMs) || ageMs < 0 || ageMs >= RUNTIME_LATEST_RELEASE_CACHE_TTL_MS) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function writeRuntimeLatestReleaseCache(runtimeDir: string, cache: RuntimeLatestReleaseCache): void {
  /* Keep cache human-readable because operators may inspect runtime-config directly during update incidents. */
  fs.writeFileSync(path.join(runtimeDir, RUNTIME_LATEST_RELEASE_CACHE_FILE), JSON.stringify(cache, null, 2), "utf-8");
}

function isValidCacheShape(value: Partial<RuntimeLatestReleaseCache>): value is RuntimeLatestReleaseCache {
  /* Only complete release identity is reusable; notes and commit SHA are intentionally nullable metadata. */
  return typeof value.version === "string" && value.version.trim().length > 0
    && typeof value.imageTag === "string" && value.imageTag.trim().length > 0
    && (typeof value.commitSha === "string" || value.commitSha === null)
    && (typeof value.releaseNotes === "string" || value.releaseNotes === null)
    && typeof value.checkedAt === "string";
}
