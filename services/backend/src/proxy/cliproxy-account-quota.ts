/**
 * @fileoverview Live CLIProxy quota parsing helpers for Mini App account cards.
 *
 * Exports:
 * - CliproxyQuotaWindow - Normalized quota window with remaining percent and reset metadata.
 * - CliproxyAccountQuota - Compact live quota payload exposed to the Mini App.
 * - CODEX_USAGE_URL - Codex upstream usage endpoint queried via management api-call.
 * - CLAUDE_PROFILE_URL - Claude profile endpoint for plan detection.
 * - CLAUDE_USAGE_URL - Claude usage endpoint for quota windows.
 * - CODEX_REQUEST_HEADERS - Headers expected by Codex usage requests.
 * - CLAUDE_REQUEST_HEADERS - Headers expected by Claude OAuth usage/profile requests.
 * - resolveCodexChatgptAccountId - Extracts ChatGPT account id from auth file metadata or downloaded JSON.
 * - buildCodexAccountQuota - Converts Codex usage payload into normalized live quota windows.
 * - buildClaudeAccountQuota - Converts Claude usage/profile payload into normalized live quota windows.
 */

import type { CliproxyAuthFile } from "./cliproxy-management.client";

const FIVE_HOUR_SECONDS = 18_000;
const WEEK_SECONDS = 604_800;

export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const CLAUDE_PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";

export const CODEX_REQUEST_HEADERS = {
  Authorization: "Bearer $TOKEN$",
  "Content-Type": "application/json",
  "User-Agent": "codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal"
} as const;

export const CLAUDE_REQUEST_HEADERS = {
  Authorization: "Bearer $TOKEN$",
  "Content-Type": "application/json",
  "anthropic-beta": "oauth-2025-04-20"
} as const;

export type CliproxyQuotaWindow = {
  id: string;
  label: string;
  remainingPercent: number;
  resetAt: string | null;
  resetAfterSeconds: number | null;
};

export type CliproxyAccountQuota = {
  mode: "live";
  planType: string | null;
  windows: CliproxyQuotaWindow[];
};

type CodexUsageWindow = {
  used_percent?: unknown;
  usedPercent?: unknown;
  limit_window_seconds?: unknown;
  limitWindowSeconds?: unknown;
  reset_after_seconds?: unknown;
  resetAfterSeconds?: unknown;
  reset_at?: unknown;
  resetAt?: unknown;
};

type CodexRateLimit = {
  primary_window?: CodexUsageWindow | null;
  primaryWindow?: CodexUsageWindow | null;
  secondary_window?: CodexUsageWindow | null;
  secondaryWindow?: CodexUsageWindow | null;
};

type CodexUsagePayload = {
  plan_type?: unknown;
  planType?: unknown;
  rate_limit?: CodexRateLimit | null;
  rateLimit?: CodexRateLimit | null;
};

type ClaudeUsageWindow = {
  utilization?: unknown;
  resets_at?: unknown;
};

type ClaudeUsagePayload = {
  five_hour?: ClaudeUsageWindow | null;
  seven_day?: ClaudeUsageWindow | null;
};

type ClaudeProfilePayload = {
  account?: {
    has_claude_max?: unknown;
    has_claude_pro?: unknown;
  } | null;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const normalizeNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return null;
};

const clampPercent = (value: number): number => {
  return Math.max(0, Math.min(100, Math.round(value)));
};

const decodeBase64UrlPayload = (value: string): string | null => {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized) {
    return null;
  }

  try {
    return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="), "base64").toString("utf8");
  } catch {
    return null;
  }
};

const parseJsonObject = (value: unknown): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const jwtParts = normalized.split(".");
    if (jwtParts.length < 2) {
      return null;
    }
    const payload = decodeBase64UrlPayload(jwtParts[1]);
    if (!payload) {
      return null;
    }
    try {
      const parsed = JSON.parse(payload) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
};

const readObject = (value: unknown): Record<string, unknown> | null => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const resolveResetAt = (value: unknown): string | null => {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  const numericValue = normalizeNumber(value);
  if (numericValue === null) {
    return null;
  }

  const milliseconds = numericValue > 10_000_000_000 ? numericValue : numericValue * 1000;
  const parsed = new Date(milliseconds);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const resolveCodexWindowLabel = (window: CodexUsageWindow | null | undefined, fallbackLabel: string): string => {
  const seconds = normalizeNumber(window?.limit_window_seconds ?? window?.limitWindowSeconds);
  if (seconds === FIVE_HOUR_SECONDS) {
    return "5 часов";
  }
  if (seconds === WEEK_SECONDS) {
    return "7 дней";
  }
  return fallbackLabel;
};

export const resolveCodexChatgptAccountId = (
  entry: Pick<CliproxyAuthFile, "idToken" | "metadata" | "attributes">,
  downloadedAuthFile?: Record<string, unknown> | null
): string | null => {
  /* Codex usage endpoint requires ChatGPT account id, so check runtime metadata and downloaded auth JSON. */
  const metadata = readObject(entry.metadata);
  const attributes = readObject(entry.attributes);

  const candidates = [
    entry.idToken,
    metadata?.id_token,
    attributes?.id_token,
    downloadedAuthFile?.id_token,
    downloadedAuthFile?.metadata,
    downloadedAuthFile?.attributes
  ];

  for (const candidate of candidates) {
    const payload = parseJsonObject(candidate);
    const accountId = normalizeString(payload?.chatgpt_account_id ?? payload?.chatgptAccountId);
    if (accountId) {
      return accountId;
    }
  }

  return null;
};

export const buildCodexAccountQuota = (payload: unknown): CliproxyAccountQuota | null => {
  /* Codex exposes used percentages per window, so invert them into remaining quota percentages for the UI. */
  const normalized = readObject(payload) as CodexUsagePayload | null;
  if (!normalized) {
    return null;
  }

  const rateLimit = readObject(normalized.rate_limit ?? normalized.rateLimit) as CodexRateLimit | null;
  if (!rateLimit) {
    return null;
  }

  const windows: CliproxyQuotaWindow[] = [];
  const candidates: Array<{ id: string; label: string; window: CodexUsageWindow | null | undefined }> = [
    {
      id: "five-hour",
      label: "5 часов",
      window: (rateLimit.primary_window ?? rateLimit.primaryWindow ?? null) as CodexUsageWindow | null
    },
    {
      id: "weekly",
      label: "7 дней",
      window: (rateLimit.secondary_window ?? rateLimit.secondaryWindow ?? null) as CodexUsageWindow | null
    }
  ];

  candidates.forEach((candidate) => {
    const usedPercent = normalizeNumber(candidate.window?.used_percent ?? candidate.window?.usedPercent);
    if (usedPercent === null) {
      return;
    }

    windows.push({
      id: candidate.id,
      label: resolveCodexWindowLabel(candidate.window, candidate.label),
      remainingPercent: clampPercent(100 - usedPercent),
      resetAt: resolveResetAt(candidate.window?.reset_at ?? candidate.window?.resetAt),
      resetAfterSeconds: normalizeNumber(candidate.window?.reset_after_seconds ?? candidate.window?.resetAfterSeconds)
    });
  });

  if (windows.length === 0) {
    return null;
  }

  return {
    mode: "live",
    planType: normalizeString(normalized.plan_type ?? normalized.planType),
    windows
  };
};

const resolveClaudePlanType = (profile: unknown): string | null => {
  const normalized = readObject(profile) as ClaudeProfilePayload | null;
  if (!normalized?.account) {
    return null;
  }

  const hasMax = normalizeBoolean(normalized.account.has_claude_max);
  if (hasMax === true) {
    return "max";
  }

  const hasPro = normalizeBoolean(normalized.account.has_claude_pro);
  if (hasPro === true) {
    return "pro";
  }

  if (hasMax === false && hasPro === false) {
    return "free";
  }

  return null;
};

export const buildClaudeAccountQuota = (usagePayload: unknown, profilePayload?: unknown): CliproxyAccountQuota | null => {
  /* Claude usage payload already provides utilization per window, so normalize it directly for the card UI. */
  const normalized = readObject(usagePayload) as ClaudeUsagePayload | null;
  if (!normalized) {
    return null;
  }

  const windows: CliproxyQuotaWindow[] = [];
  const candidates: Array<{ id: string; label: string; window: ClaudeUsageWindow | null | undefined }> = [
    { id: "five-hour", label: "5 часов", window: normalized.five_hour ?? null },
    { id: "seven-day", label: "7 дней", window: normalized.seven_day ?? null }
  ];

  candidates.forEach((candidate) => {
    const usedPercent = normalizeNumber(candidate.window?.utilization);
    if (usedPercent === null) {
      return;
    }

    windows.push({
      id: candidate.id,
      label: candidate.label,
      remainingPercent: clampPercent(100 - usedPercent),
      resetAt: resolveResetAt(candidate.window?.resets_at),
      resetAfterSeconds: null
    });
  });

  if (windows.length === 0) {
    return null;
  }

  return {
    mode: "live",
    planType: resolveClaudePlanType(profilePayload),
    windows
  };
};
