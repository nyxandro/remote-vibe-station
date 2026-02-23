/**
 * @fileoverview Helpers for user-facing backend HTTP error messages.
 *
 * Key constructs:
 * - buildBackendErrorMessage (L18) - Extracts readable text from backend status/body.
 * - tryReadJsonMessage (L31) - Best-effort parser for `{ message: string }` payloads.
 */

type BackendErrorPayload = unknown;

const FALLBACK_STATUS_PREFIX = "Ошибка backend";

const isNonEmptyString = (value: unknown): value is string => {
  /* Keep validation strict to avoid rendering noisy placeholders. */
  return typeof value === "string" && value.trim().length > 0;
};

export const buildBackendErrorMessage = (status: number, payload: BackendErrorPayload): string => {
  /* Prefer backend-provided structured message when it exists. */
  const parsed = tryReadJsonMessage(payload);
  if (parsed) {
    return parsed;
  }

  /* Fallback stays concise so chats are readable on mobile. */
  return `${FALLBACK_STATUS_PREFIX} (${status})`;
};

const tryReadJsonMessage = (payload: BackendErrorPayload): string | null => {
  /* Accept object payload directly (already parsed JSON). */
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const message = (payload as Record<string, unknown>).message;
    return isNonEmptyString(message) ? message.trim() : null;
  }

  /* Parse string body as JSON only when it looks like JSON. */
  if (!isNonEmptyString(payload) || payload.trim().charAt(0) !== "{") {
    return null;
  }

  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return isNonEmptyString(parsed.message) ? parsed.message.trim() : null;
  } catch {
    return null;
  }
};
