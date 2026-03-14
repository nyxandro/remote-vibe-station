/**
 * @fileoverview Shared normalization for transient OpenCode transport failures.
 *
 * Exports:
 * - isOpenCodeFetchTransportFailure - Detects low-level fetch crashes from OpenCode HTTP calls.
 * - describeOpenCodeTransportFailure - Extracts compact root-cause details for operator logs.
 * - logOpenCodeTransportFailure - Emits one compact diagnostic line for transport failures.
 * - normalizeOpenCodeTransportErrorMessage - Converts low-signal transport errors into human-readable text.
 */

export const isOpenCodeFetchTransportFailure = (error: unknown): boolean => {
  /* Low-level fetch failures are transport crashes, not useful user-facing explanations. */
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("fetch failed");
};

export const describeOpenCodeTransportFailure = (error: unknown): {
  message: string;
  causeMessage: string | null;
  code: string | null;
} => {
  /* Keep the transport breadcrumb compact so one log line is enough to diagnose container/network failures. */
  const normalizedError = error instanceof Error ? error : new Error(String(error));
  const cause = normalizedError.cause;
  const causeMessage = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : null;
  const code =
    cause && typeof cause === "object" && "code" in cause && typeof (cause as { code?: unknown }).code === "string"
      ? ((cause as { code: string }).code ?? null)
      : null;

  return {
    message: normalizedError.message,
    causeMessage,
    code
  };
};

export const logOpenCodeTransportFailure = (input: {
  scope: string;
  directory: string;
  sessionID?: string | null;
  projectSlug?: string | null;
  adminId?: number | null;
  action?: string | null;
  error: unknown;
}): void => {
  /* Emit exactly one structured line per failed transport so logs stay small even during intermittent flaps. */
  const details = describeOpenCodeTransportFailure(input.error);
  console.error(
    JSON.stringify({
      level: "error",
      type: "opencode_transport_failure",
      scope: input.scope,
      action: input.action ?? null,
      directory: input.directory,
      sessionID: input.sessionID ?? null,
      projectSlug: input.projectSlug ?? null,
      adminId: input.adminId ?? null,
      message: details.message,
      causeMessage: details.causeMessage,
      code: details.code
    })
  );
};

export const normalizeOpenCodeTransportErrorMessage = (error: unknown): string => {
  /* Operators need actionable context instead of raw undifferentiated fetch errors. */
  if (isOpenCodeFetchTransportFailure(error)) {
    return "APP_OPENCODE_TRANSPORT_FAILED: потеряно соединение с OpenCode. Если ответ не появился через runtime events, повторите попытку позже.";
  }

  return error instanceof Error ? error.message : String(error);
};
