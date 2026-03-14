/**
 * @fileoverview Shared normalization for transient OpenCode transport failures.
 *
 * Exports:
 * - isOpenCodeFetchTransportFailure - Detects low-level fetch crashes from OpenCode HTTP calls.
 * - normalizeOpenCodeTransportErrorMessage - Converts low-signal transport errors into human-readable text.
 */

export const isOpenCodeFetchTransportFailure = (error: unknown): boolean => {
  /* Low-level fetch failures are transport crashes, not useful user-facing explanations. */
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("fetch failed");
};

export const normalizeOpenCodeTransportErrorMessage = (error: unknown): string => {
  /* Operators need actionable context instead of raw undifferentiated fetch errors. */
  if (isOpenCodeFetchTransportFailure(error)) {
    return "APP_OPENCODE_TRANSPORT_FAILED: потеряно соединение с OpenCode. Если ответ не появился через runtime events, повторите попытку позже.";
  }

  return error instanceof Error ? error.message : String(error);
};
