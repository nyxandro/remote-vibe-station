/**
 * @fileoverview Normalizes OpenCode HTTP errors into user-facing messages.
 *
 * Exports:
 * - formatOpenCodeHttpError (L75) - Builds concise error text with optional retry hint.
 */

const RETRY_HINT_PREFIX = "Повтор через";

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord => {
  /* Restrict nested field access to plain object values. */
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const readString = (value: unknown): string | null => {
  /* Keep message extraction strict to avoid rendering noisy placeholders. */
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const readRetrySeconds = (value: unknown): number | null => {
  /* Normalize retry hints to positive whole seconds for chat output. */
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.ceil(value);
  }

  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.ceil(numeric);
    }

    const parsedDateMs = Date.parse(value);
    if (Number.isFinite(parsedDateMs)) {
      const deltaMs = parsedDateMs - Date.now();
      if (deltaMs > 0) {
        return Math.ceil(deltaMs / 1000);
      }
    }
  }

  return null;
};

const parseJsonBody = (bodyText: string): JsonRecord | null => {
  /* Parse JSON body best-effort; non-JSON responses are handled as plain text. */
  if (!bodyText) {
    return null;
  }

  try {
    const parsed = JSON.parse(bodyText);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const extractMessage = (json: JsonRecord | null, bodyText: string): string | null => {
  /* Check common OpenCode/provider error payload shapes in priority order. */
  if (!json) {
    return readString(bodyText);
  }

  const direct = readString(json.message) ?? readString(json.error) ?? readString(json.detail);
  if (direct) {
    return direct;
  }

  if (isRecord(json.error)) {
    const nested = readString(json.error.message) ?? readString(json.error.detail);
    if (nested) {
      return nested;
    }
  }

  return null;
};

const extractRetrySeconds = (json: JsonRecord | null, retryAfterHeader: string | null): number | null => {
  /* Prefer explicit JSON retry fields, then fallback to Retry-After header. */
  const jsonRetry =
    (json ? readRetrySeconds(json.retryAfterSec) : null) ??
    (json ? readRetrySeconds(json.retry_after) : null) ??
    (json ? readRetrySeconds(json.retryAfter) : null) ??
    (json && isRecord(json.error) ? readRetrySeconds(json.error.retryAfter) : null);

  return jsonRetry ?? readRetrySeconds(retryAfterHeader);
};

export const formatOpenCodeHttpError = (input: {
  status: number;
  bodyText: string;
  retryAfterHeader: string | null;
}): string => {
  /* Build one stable user-facing string for bot and Mini App surfaces. */
  const json = parseJsonBody(input.bodyText);
  const message = extractMessage(json, input.bodyText) ?? `OpenCode request failed: ${input.status}`;
  const retryAfterSec = extractRetrySeconds(json, input.retryAfterHeader);

  if (!retryAfterSec) {
    return message;
  }

  return `${message}. ${RETRY_HINT_PREFIX} ${retryAfterSec} сек.`;
};
