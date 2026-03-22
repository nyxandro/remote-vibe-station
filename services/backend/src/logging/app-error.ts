/**
 * @fileoverview Shared backend error-contract helpers.
 *
 * Exports:
 * - AppErrorBody - Stable JSON payload returned for backend errors.
 * - createAppErrorBody - Builds normalized `code/message/hint` objects.
 * - normalizeUnknownErrorToAppError - Preserves useful domain messages while attaching fallback code/hint.
 * - resolveExceptionAppError - Converts thrown exceptions into the public error contract.
 */

import { HttpException } from "@nestjs/common";

export type AppErrorBody = {
  code: string;
  message: string;
  hint: string | null;
};

type AppErrorDefaults = {
  code: string;
  message: string;
  hint: string | null;
};

const APP_ERROR_PREFIX = /^([A-Z0-9_]+):\s*(.+)$/s;
const DEFAULT_ERRORS_BY_STATUS: Record<number, AppErrorDefaults> = {
  400: {
    code: "APP_BAD_REQUEST",
    message: "Request payload is invalid.",
    hint: "Check request data and retry."
  },
  401: {
    code: "APP_AUTH_REQUIRED",
    message: "Authentication is missing or invalid.",
    hint: "Provide Telegram initData or a valid browser token and retry."
  },
  403: {
    code: "APP_FORBIDDEN",
    message: "Access denied for this operation.",
    hint: "Use an allowed admin account or update permissions, then retry."
  },
  404: {
    code: "APP_NOT_FOUND",
    message: "Requested resource was not found.",
    hint: "Check the resource identifier or refresh the page and retry."
  },
  409: {
    code: "APP_CONFLICT",
    message: "Request conflicts with the current resource state.",
    hint: "Refresh current state and retry the operation."
  },
  500: {
    code: "APP_INTERNAL_ERROR",
    message: "Unexpected server error while processing request.",
    hint: "Retry the request. If it keeps failing, inspect backend logs with requestId."
  }
};

export const createAppErrorBody = (input: {
  code: string;
  message: string;
  hint?: string | null;
}): AppErrorBody => {
  /* Keep every backend error payload on one stable shape for frontend and bot clients. */
  return {
    code: normalizeNonEmptyString(input.code) ?? DEFAULT_ERRORS_BY_STATUS[500].code,
    message: normalizeNonEmptyString(input.message) ?? DEFAULT_ERRORS_BY_STATUS[500].message,
    hint: normalizeNonEmptyString(input.hint) ?? null
  };
};

export const normalizeUnknownErrorToAppError = (input: {
  error: unknown;
  fallbackCode: string;
  fallbackMessage: string;
  fallbackHint?: string | null;
}): AppErrorBody => {
  /* Controller/service catch blocks preserve actionable domain text while attaching stable error metadata. */
  const fallback = createAppErrorBody({
    code: input.fallbackCode,
    message: input.fallbackMessage,
    hint: input.fallbackHint ?? null
  });
  const rawMessage = extractRawErrorMessage(input.error);
  if (!rawMessage) {
    return fallback;
  }

  const parsed = parseAppPrefixedMessage(rawMessage);
  if (parsed) {
    return createAppErrorBody({
      code: parsed.code,
      message: parsed.message,
      hint: fallback.hint
    });
  }

  return createAppErrorBody({
    code: fallback.code,
    message: rawMessage,
    hint: fallback.hint
  });
};

export const resolveExceptionAppError = (input: { exception: unknown; statusCode: number }): AppErrorBody => {
  /* Global filter normalizes both explicit app errors and legacy string exceptions into one public contract. */
  const defaults = resolveDefaultError(input.statusCode);
  const explicitBody = extractExceptionResponseBody(input.exception);
  if (explicitBody) {
    return explicitBody;
  }

  const rawMessage = extractRawErrorMessage(input.exception);
  if (!rawMessage) {
    return defaults;
  }

  const parsed = parseAppPrefixedMessage(rawMessage);
  if (parsed) {
    return createAppErrorBody({
      code: parsed.code,
      message: parsed.message,
      hint: defaults.hint
    });
  }

  if (input.statusCode >= 500) {
    return defaults;
  }

  return createAppErrorBody({
    code: defaults.code,
    message: rawMessage,
    hint: defaults.hint
  });
};

const extractExceptionResponseBody = (exception: unknown): AppErrorBody | null => {
  /* Explicit HttpException bodies win so guards/controllers can override defaults intentionally. */
  if (!(exception instanceof HttpException)) {
    return null;
  }

  const responseBody = exception.getResponse();
  if (!responseBody || typeof responseBody !== "object" || Array.isArray(responseBody)) {
    return null;
  }

  const record = responseBody as Record<string, unknown>;
  const code = normalizeNonEmptyString(record.code);
  const message = normalizeMessageValue(record.message);
  if (!code || !message) {
    return null;
  }

  return createAppErrorBody({
    code,
    message,
    hint: normalizeNonEmptyString(record.hint) ?? null
  });
};

const extractRawErrorMessage = (error: unknown): string | null => {
  /* Legacy errors may still use plain strings or HttpException default response bodies. */
  if (error instanceof HttpException) {
    const responseBody = error.getResponse();
    if (typeof responseBody === "string") {
      return normalizeNonEmptyString(responseBody);
    }

    if (responseBody && typeof responseBody === "object" && !Array.isArray(responseBody)) {
      return normalizeMessageValue((responseBody as Record<string, unknown>).message);
    }

    return normalizeNonEmptyString(error.message);
  }

  if (error instanceof Error) {
    return normalizeNonEmptyString(error.message);
  }

  if (typeof error === "string") {
    return normalizeNonEmptyString(error);
  }

  return null;
};

const normalizeMessageValue = (value: unknown): string | null => {
  /* Nest validation errors may surface as arrays, so collapse them into one stable message string. */
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => normalizeNonEmptyString(item))
      .filter((item): item is string => item !== null);
    return parts.length > 0 ? parts.join("; ") : null;
  }

  return normalizeNonEmptyString(value);
};

const normalizeNonEmptyString = (value: unknown): string | null => {
  /* Shared string sanitizer keeps whitespace-only values from leaking into the public contract. */
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const parseAppPrefixedMessage = (rawMessage: string): { code: string; message: string } | null => {
  /* Existing `APP_CODE: message` strings remain valid and are upgraded into structured JSON centrally. */
  const match = rawMessage.match(APP_ERROR_PREFIX);
  if (!match) {
    return null;
  }

  return {
    code: match[1],
    message: match[2].trim()
  };
};

const resolveDefaultError = (statusCode: number): AppErrorBody => {
  /* Unknown statuses still fall back to the generic internal-error contract. */
  const fallback = DEFAULT_ERRORS_BY_STATUS[statusCode] ?? DEFAULT_ERRORS_BY_STATUS[500];
  return createAppErrorBody(fallback);
};
