/**
 * @fileoverview Utilities for manual stale-session repair flow.
 *
 * Exports:
 * - isBusySessionStale (L8) - Evaluates whether busy session age exceeds repair timeout.
 */

export const isBusySessionStale = (updatedAtRaw: string | number | undefined, busyTimeoutMs: number): boolean => {
  /* Invalid timeout indicates a programming/config issue and must fail fast. */
  if (!Number.isFinite(busyTimeoutMs) || busyTimeoutMs <= 0) {
    throw new Error(`Invalid busy timeout: ${busyTimeoutMs}`);
  }

  /* Missing/invalid timestamps are treated as stale for explicit manual /repair action. */
  if (typeof updatedAtRaw === "undefined") {
    return true;
  }

  /* Normalize numeric and ISO timestamps to epoch milliseconds. */
  const updatedAtMs = typeof updatedAtRaw === "number" ? updatedAtRaw : Date.parse(updatedAtRaw);
  if (!Number.isFinite(updatedAtMs)) {
    return true;
  }

  /* Busy sessions older than timeout are considered stuck and safe to abort. */
  return Date.now() - updatedAtMs >= busyTimeoutMs;
};
