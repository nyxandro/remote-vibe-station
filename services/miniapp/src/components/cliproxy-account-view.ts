/**
 * @fileoverview Presentation helpers for compact CLIProxy account cards.
 *
 * Exports:
 * - CliproxyAccountViewModel - Prepared account summary/body data for the accordion UI.
 * - buildCliproxyAccountViewModel - Normalizes identity, status, and quota data for rendering.
 * - formatCliproxyUsageDate - Formats the last activity timestamp for expanded diagnostics.
 * - formatCliproxyUsageNumber - Formats usage counters for expanded diagnostics.
 */

import { CliproxyAccountState } from "../types";

type CliproxyAccount = CliproxyAccountState["accounts"][number];
type CliproxyQuotaWindow = NonNullable<CliproxyAccount["quota"]>["windows"][number];
type BadgeTone = "connected" | "disconnected" | "error" | "warning";

type ParsedCliproxyStatusMessage = {
  details: string[];
  isQuotaExceeded: boolean;
};

type CliproxyQuotaSummary = {
  label: string;
  value: number;
  meterText: string;
  resetText: string | null;
  ariaLabel: string;
  ariaValueText: string;
};

export type CliproxyAccountViewModel = {
  primaryIdentity: string;
  extraDetails: string[];
  collapsedQuotas: CliproxyQuotaSummary[];
  expandedQuotas: CliproxyQuotaSummary[];
  quota: CliproxyQuotaSummary;
  statusBadge: {
    label: string;
    tone: BadgeTone;
  };
};

const SECONDS_IN_DAY = 86_400;
const SECONDS_IN_HOUR = 3_600;
const SECONDS_IN_MINUTE = 60;
const MAX_PERCENT = 100;
const MIN_PERCENT = 0;
const TRIVIAL_STATUS_DETAILS = new Set(["ok", "ready", "connected", "active", "success"]);
const ERROR_STATUS_PATTERN = /error|failed|quota|limit|invalid|deactivated|blocked/i;
const WARNING_STATUS_PATTERN = /pending|paused|warning|degraded|retry/i;
const WEEK_WINDOW_PATTERN = /week|нед/i;
const DAY_WINDOW_PATTERN = /day|сут|дн|24\s*час/i;

const formatDuration = (seconds: number): string => {
  /* Relative reset counters must stay compact because they are rendered inside dense mobile cards. */
  const normalizedSeconds = Math.max(0, Math.trunc(seconds));
  const days = Math.floor(normalizedSeconds / SECONDS_IN_DAY);
  const hours = Math.floor((normalizedSeconds % SECONDS_IN_DAY) / SECONDS_IN_HOUR);
  const minutes = Math.floor((normalizedSeconds % SECONDS_IN_HOUR) / SECONDS_IN_MINUTE);
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}д`);
  }
  if (hours > 0) {
    parts.push(`${hours}ч`);
  }
  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes}м`);
  }

  return parts.join(" ");
};

const normalizeCliproxyStatusMessage = (value: string | null): ParsedCliproxyStatusMessage => {
  /* Structured provider errors should become short operator-friendly lines instead of raw JSON blobs. */
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return { details: [], isQuotaExceeded: false };
  }

  try {
    const parsed = JSON.parse(normalized) as {
      error?: {
        type?: unknown;
        message?: unknown;
        plan_type?: unknown;
        resets_at?: unknown;
        resets_in_seconds?: unknown;
        code?: unknown;
      };
      status?: unknown;
    };
    const error = parsed?.error;
    if (!error || typeof error !== "object") {
      return { details: [normalized], isQuotaExceeded: false };
    }

    const details: string[] = [];
    const errorType = typeof error.type === "string" ? error.type.trim() : "";
    const message = typeof error.message === "string" ? error.message.trim() : "";
    const planType = typeof error.plan_type === "string" ? error.plan_type.trim() : "";
    const errorCode = typeof error.code === "string" ? error.code.trim() : "";
    const statusCode =
      typeof parsed.status === "number" && Number.isFinite(parsed.status) ? Math.trunc(parsed.status) : null;
    const resetsAtValue = typeof error.resets_at === "number" ? error.resets_at : Number.NaN;
    const resetsAt = Number.isFinite(resetsAtValue) ? new Date(resetsAtValue * 1000) : null;
    const resetsInSecondsValue =
      typeof error.resets_in_seconds === "number" ? error.resets_in_seconds : Number.NaN;
    const isQuotaExceeded = errorType === "usage_limit_reached";

    if (errorType) {
      details.push(`Ошибка: ${errorType}`);
    }

    if (message) {
      const translatedMessage =
        errorCode === "account_deactivated"
          ? "OpenAI сообщает, что аккаунт деактивирован. Проверь почту этого аккаунта."
          : message;
      details.push(translatedMessage);
    }

    if (planType) {
      details.push(`Тариф: ${planType}`);
    }

    if (errorCode) {
      details.push(`Код: ${errorCode}`);
    }

    if (statusCode !== null) {
      details.push(`HTTP статус: ${statusCode}`);
    }

    if (resetsAt && !Number.isNaN(resetsAt.getTime())) {
      details.push(`Лимит сбросится: ${resetsAt.toLocaleString()}`);
    }

    if (Number.isFinite(resetsInSecondsValue)) {
      details.push(`Сброс через: ${formatDuration(resetsInSecondsValue)}`);
    }

    return {
      details: details.length > 0 ? details : [normalized],
      isQuotaExceeded
    };
  } catch {
    /* Plain-text upstream details should still remain visible when CLIProxy does not return JSON. */
    return { details: [normalized], isQuotaExceeded: false };
  }
};

const getPrimaryIdentity = (account: CliproxyAccount): string => {
  /* Email is the most useful operator handle, then fall back to provider-specific identifiers. */
  const candidates = [account.email, account.account, account.name, account.label, account.id];

  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return account.id;
};

const getStatusBadge = (
  account: CliproxyAccount,
  parsedStatus: ParsedCliproxyStatusMessage
): CliproxyAccountViewModel["statusBadge"] => {
  /* Badge tone should reflect the actionable state instead of always showing a green chip for errors. */
  const normalizedStatus = String(account.status ?? "").trim();
  const label = normalizedStatus || (account.disabled ? "disabled" : parsedStatus.isQuotaExceeded ? "error" : "connected");

  if (account.unavailable || parsedStatus.isQuotaExceeded || ERROR_STATUS_PATTERN.test(label)) {
    return { label, tone: "error" };
  }
  if (account.disabled) {
    return { label, tone: "disconnected" };
  }
  if (WARNING_STATUS_PATTERN.test(label)) {
    return { label, tone: "warning" };
  }

  return { label, tone: "connected" };
};

const getQuotaResetText = (window: CliproxyQuotaWindow): string | null => {
  /* Reset hints should prefer absolute timestamps, then degrade to human-readable countdowns. */
  if (window.resetAt) {
    const parsed = new Date(window.resetAt);
    if (!Number.isNaN(parsed.getTime())) {
      return `Сброс: ${parsed.toLocaleString()}`;
    }
  }

  if (typeof window.resetAfterSeconds === "number" && Number.isFinite(window.resetAfterSeconds)) {
    return `Сброс через ${formatDuration(window.resetAfterSeconds)}`;
  }

  return null;
};

const getPreferredQuotaWindow = (account: CliproxyAccount): CliproxyQuotaWindow | null => {
  /* The primary meter should stay the shortest actionable window so the card headline remains immediately useful. */
  if (account.quota?.mode !== "live" || account.quota.windows.length === 0) {
    return null;
  }

  const rankedWindows = [...account.quota.windows].sort((left, right) => {
    const leftDuration =
      typeof left.resetAfterSeconds === "number" && Number.isFinite(left.resetAfterSeconds)
        ? left.resetAfterSeconds
        : Number.MAX_SAFE_INTEGER;
    const rightDuration =
      typeof right.resetAfterSeconds === "number" && Number.isFinite(right.resetAfterSeconds)
        ? right.resetAfterSeconds
        : Number.MAX_SAFE_INTEGER;

    return leftDuration - rightDuration;
  });

  return (
    rankedWindows.find((window) => !WEEK_WINDOW_PATTERN.test(window.label) && !WEEK_WINDOW_PATTERN.test(window.id)) ??
    rankedWindows[0]
  );
};

const buildQuotaSummary = (account: CliproxyAccount, window: CliproxyQuotaWindow): CliproxyQuotaSummary => {
  /* Every quota window uses the same meter contract so summary and expanded sections stay visually consistent. */
  const value = Math.min(MAX_PERCENT, Math.max(MIN_PERCENT, Math.trunc(window.remainingPercent)));
  const meterText = `${value}% осталось`;

  return {
    label: window.label,
    value,
    meterText,
    resetText: getQuotaResetText(window),
    ariaLabel: `Лимит ${window.label} для ${account.providerLabel}`,
    ariaValueText: `${window.label}: ${meterText}`
  };
};

const getQuotaWindows = (account: CliproxyAccount): CliproxyQuotaWindow[] => {
  /* Window ordering should stay deterministic so operators always read quotas from shortest to longest. */
  if (account.quota?.mode !== "live" || account.quota.windows.length === 0) {
    return [];
  }

  return [...account.quota.windows].sort((left, right) => {
    const leftDuration =
      typeof left.resetAfterSeconds === "number" && Number.isFinite(left.resetAfterSeconds)
        ? left.resetAfterSeconds
        : Number.MAX_SAFE_INTEGER;
    const rightDuration =
      typeof right.resetAfterSeconds === "number" && Number.isFinite(right.resetAfterSeconds)
        ? right.resetAfterSeconds
        : Number.MAX_SAFE_INTEGER;

    return leftDuration - rightDuration;
  });
};

const getCollapsedQuotaWindows = (account: CliproxyAccount): CliproxyQuotaWindow[] => {
  /* Collapsed cards should show the shortest getQuotaWindows result plus dailyWindow when it exists, never the weekly-only summary. */
  const rankedWindows = getQuotaWindows(account);
  if (rankedWindows.length === 0) {
    return [];
  }

  const shortestWindow = rankedWindows[0] ?? null;
  const dailyWindow =
    rankedWindows.find((window) => DAY_WINDOW_PATTERN.test(window.label) || DAY_WINDOW_PATTERN.test(window.id)) ?? null;
  const windows = [shortestWindow, dailyWindow].filter((window): window is CliproxyQuotaWindow => window !== null);

  return windows.filter((window, index, collection) => collection.findIndex((candidate) => candidate.id === window.id) === index);
};

const getExpandedQuotaWindows = (account: CliproxyAccount): CliproxyQuotaWindow[] => {
  /* Expanded cards should surface all non-duplicate quota windows, including the weekly summary. */
  return getQuotaWindows(account);
};

const getQuotaSummary = (
  account: CliproxyAccount,
  parsedStatus: ParsedCliproxyStatusMessage
): CliproxyQuotaSummary => {
  /* Exhausted or unavailable accounts should always read as empty even if stale live windows still exist. */
  if (parsedStatus.isQuotaExceeded || account.unavailable) {
    return {
      label: "Квота исчерпана",
      value: MIN_PERCENT,
      meterText: "Квота исчерпана",
      resetText: null,
      ariaLabel: `Состояние квоты для ${account.providerLabel}`,
      ariaValueText: "Квота исчерпана"
    };
  }

  const preferredWindow = getPreferredQuotaWindow(account);
  if (!preferredWindow) {
    return {
      label: "Квота доступна",
      value: MAX_PERCENT,
      meterText: "Квота доступна",
      resetText: null,
      ariaLabel: `Состояние квоты для ${account.providerLabel}`,
      ariaValueText: "Квота доступна"
    };
  }

  return buildQuotaSummary(account, preferredWindow);
};

const getExtraDetails = (
  account: CliproxyAccount,
  primaryIdentity: string,
  parsedStatus: ParsedCliproxyStatusMessage
): string[] => {
  /* Expanded diagnostics should preserve only unique, actionable lines instead of repeating identity noise. */
  const uniqueDetails = new Set<string>();
  const statusLabel = String(account.status ?? "").trim().toLowerCase();

  [account.account, account.label, account.name].forEach((value) => {
    const normalized = String(value ?? "").trim();
    if (normalized && normalized !== primaryIdentity) {
      uniqueDetails.add(normalized);
    }
  });

  if (account.quota?.mode === "live" && account.quota.planType) {
    uniqueDetails.add(`Тариф: ${account.quota.planType}`);
  }

  parsedStatus.details.forEach((detail) => {
    const normalized = detail.trim();
    const lowered = normalized.toLowerCase();

    if (!normalized || normalized === primaryIdentity) {
      return;
    }
    if (TRIVIAL_STATUS_DETAILS.has(lowered) || lowered === statusLabel) {
      return;
    }

    uniqueDetails.add(normalized);
  });

  return Array.from(uniqueDetails);
};

export const formatCliproxyUsageNumber = (value: number): string => {
  /* Locale-aware formatting keeps token and request counters readable on mobile cards. */
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.trunc(value)));
};

export const formatCliproxyUsageDate = (value: string | null): string => {
  /* Empty timestamps should read as no activity yet instead of leaking Invalid Date into the UI. */
  if (!value) {
    return "еще нет";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "еще нет" : parsed.toLocaleString();
};

export const buildCliproxyAccountViewModel = (account: CliproxyAccount): CliproxyAccountViewModel => {
  /* Build one view model so the accordion component stays focused on markup and interactions. */
  const parsedStatus = normalizeCliproxyStatusMessage(account.statusMessage);
  const primaryIdentity = getPrimaryIdentity(account);
  const collapsedQuotas = getCollapsedQuotaWindows(account).map((window) => buildQuotaSummary(account, window));
  const expandedQuotas = getExpandedQuotaWindows(account).map((window) => buildQuotaSummary(account, window));
  const quota = getQuotaSummary(account, parsedStatus);

  return {
    primaryIdentity,
    extraDetails: getExtraDetails(account, primaryIdentity, parsedStatus),
    collapsedQuotas: collapsedQuotas.length > 0 ? collapsedQuotas : [quota],
    expandedQuotas: expandedQuotas.length > 0 ? expandedQuotas : [quota],
    quota,
    statusBadge: getStatusBadge(account, parsedStatus)
  };
};
