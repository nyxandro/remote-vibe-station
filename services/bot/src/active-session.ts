/**
 * @fileoverview Helpers for reading and rendering currently active OpenCode session for Telegram messages.
 *
 * Exports:
 * - fetchActiveSessionTitle (L21) - Loads active session title from backend sessions endpoint.
 * - formatActiveSessionLine (L52) - Formats user-facing session line with fallback text.
 */

type SessionsPayload = {
  ok?: boolean;
  sessions?: Array<{
    title?: string | null;
    active?: boolean;
  }>;
};

const ACTIVE_SESSION_FETCH_TIMEOUT_MS = 5000;

export const fetchActiveSessionTitle = async (backendUrl: string, adminId: number): Promise<string | null> => {
  /* Read sessions from backend and pick only explicitly active entry. */
  let response: Response;
  try {
    response = await fetch(`${backendUrl}/api/telegram/sessions`, {
      headers: {
        "x-admin-id": String(adminId)
      },
      signal: AbortSignal.timeout(ACTIVE_SESSION_FETCH_TIMEOUT_MS)
    });
  } catch (error) {
    /* Surface timeout/error with backend context to simplify troubleshooting. */
    if ((error as { name?: string } | null)?.name === "AbortError") {
      throw new Error(
        `Failed to load sessions: request timed out after ${ACTIVE_SESSION_FETCH_TIMEOUT_MS}ms (backend=${backendUrl}, adminId=${adminId})`
      );
    }
    throw new Error(`Failed to load sessions (backend=${backendUrl}, adminId=${adminId}): ${String(error)}`);
  }

  if (!response.ok) {
    throw new Error(`Failed to load sessions: ${response.status}`);
  }

  const payload = (await response.json()) as SessionsPayload;
  if (payload.ok !== true) {
    throw new Error("Failed to load sessions: backend returned ok=false");
  }

  const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  const active = sessions.find((session) => Boolean(session?.active));
  if (!active) {
    return null;
  }

  const rawTitle = typeof active.title === "string" ? active.title.trim() : "";
  if (!rawTitle) {
    return "Без названия";
  }

  return rawTitle;
};

export const formatActiveSessionLine = (title: string | null): string => {
  /* Session title is UI-only; explicit fallback keeps status readable. */
  const sessionTitle = title && title.trim().length > 0 ? title.trim() : "не выбрана";
  return `Текущая сессия: ${sessionTitle}`;
};
