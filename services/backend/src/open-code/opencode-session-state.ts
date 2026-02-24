/**
 * @fileoverview Session-state helpers shared by OpenCode client methods.
 *
 * Exports:
 * - OpenCodeSessionSummary - Normalized session row used by Telegram picker.
 * - listSessionsViaApi - Builds session list from OpenCode session and status endpoints.
 * - createSessionViaApi - Creates and stores active session id for directory.
 * - selectSessionViaApi - Validates and sets selected active session id.
 * - isSessionBusyViaApi - Checks busy state for cached session.
 */

export type OpenCodeSessionSummary = {
  id: string;
  title: string | null;
  status: string;
  updatedAt: string | null;
};

export const listSessionsViaApi = async (input: {
  request: <T>(path: string, init: RequestInit) => Promise<T>;
  directory: string;
  limit: number;
}): Promise<OpenCodeSessionSummary[]> => {
  /* Fetch base session list and status map to build Telegram picker rows. */
  const [sessions, statuses] = await Promise.all([
    input.request<Array<Record<string, unknown>>>(
      `/session?directory=${encodeURIComponent(input.directory)}&limit=${input.limit}`,
      { method: "GET" }
    ),
    input.request<Record<string, { type?: string; updatedAt?: string | number }>>(
      `/session/status?directory=${encodeURIComponent(input.directory)}`,
      { method: "GET" }
    )
  ]);

  /* Normalize optional title/status fields because OpenCode payload is not strictly typed. */
  return (Array.isArray(sessions) ? sessions : [])
    .map((item) => {
      const id = String(item?.id ?? "").trim();
      if (!id) {
        return null;
      }

      const titleRaw = item.title ?? item.name;
      const title = typeof titleRaw === "string" && titleRaw.trim().length > 0 ? titleRaw.trim() : null;
      const status = String(statuses?.[id]?.type ?? "idle").trim() || "idle";
      const updatedAtRaw = statuses?.[id]?.updatedAt ?? item.updatedAt;
      const updatedAt = typeof updatedAtRaw === "string" && updatedAtRaw.trim().length > 0 ? updatedAtRaw : null;
      return { id, title, status, updatedAt };
    })
    .filter((item): item is OpenCodeSessionSummary => item !== null);
};

export const createSessionViaApi = async (input: {
  request: <T>(path: string, init: RequestInit) => Promise<T>;
  directory: string;
  sessionIdsByDirectory: Map<string, string>;
}): Promise<{ id: string }> => {
  /* Create explicit session and pin it as active for directory-level context. */
  const response = await input.request<{ id?: string }>(
    `/session?directory=${encodeURIComponent(input.directory)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }
  );
  if (!response.id) {
    throw new Error("OpenCode session id missing in response");
  }

  input.sessionIdsByDirectory.set(input.directory, response.id);
  return { id: response.id };
};

export const selectSessionViaApi = async (input: {
  request: <T>(path: string, init: RequestInit) => Promise<T>;
  directory: string;
  sessionID: string;
  sessionIdsByDirectory: Map<string, string>;
}): Promise<void> => {
  /* Validate selected session exists in target directory before switching context. */
  const statuses = await input.request<Record<string, { type?: string }>>(
    `/session/status?directory=${encodeURIComponent(input.directory)}`,
    { method: "GET" }
  );
  if (!statuses?.[input.sessionID]) {
    throw new Error("Session not found in current project");
  }

  input.sessionIdsByDirectory.set(input.directory, input.sessionID);
};

export const isSessionBusyViaApi = async (input: {
  request: <T>(path: string, init: RequestInit) => Promise<T>;
  sessionID: string;
  directory: string;
}): Promise<boolean> => {
  /* Check whether cached session is blocked in busy status. */
  const statuses = await input.request<Record<string, { type?: string }>>(
    `/session/status?directory=${encodeURIComponent(input.directory)}`,
    { method: "GET" }
  );

  const status = statuses?.[input.sessionID];
  return status?.type === "busy";
};
