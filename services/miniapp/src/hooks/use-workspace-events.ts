/**
 * @fileoverview Workspace websocket invalidation hook for Mini App tabs.
 *
 * Exports:
 * - WorkspaceEventSurface - Supported live invalidation surfaces.
 * - useWorkspaceEvents - Subscribes to workspace events and refreshes matching UI slices.
 */

import { useEffect, useRef } from "react";

import { getEventStreamUrl } from "../api/client";
import { TabKey } from "../components/WorkspaceHeader";

export type WorkspaceEventSurface = "projects" | "git" | "files" | "settings" | "providers";

type WorkspaceStateChangedEvent = {
  type?: string;
  data?: {
    projectSlug?: string | null;
    surfaces?: WorkspaceEventSurface[];
    reason?: string;
  };
};

type RefreshKind = WorkspaceEventSurface;

const LIVE_REFRESH_DEBOUNCE_MS = 200;
const INITIAL_WS_RECONNECT_DELAY_MS = 1_000;
const MAX_WS_RECONNECT_DELAY_MS = 10_000;

export const useWorkspaceEvents = (input: {
  activeTab: TabKey;
  activeId: string | null;
  filePath: string;
  onProjectsChanged: () => Promise<void> | void;
  onGitChanged: (projectId: string) => Promise<void> | void;
  onFilesChanged: (projectId: string, path: string) => Promise<void> | void;
  onSettingsChanged: (projectId: string | null) => Promise<void> | void;
  onProvidersChanged: () => Promise<void> | void;
}): void => {
  const inputRef = useRef(input);
  const refreshTimersRef = useRef<Record<RefreshKind, number | null>>({
    projects: null,
    git: null,
    files: null,
    settings: null,
    providers: null
  });
  const reconnectTimerRef = useRef<number | null>(null);

  /* Keep socket callbacks pointed at the latest tab/project context without reconnecting for every render. */
  inputRef.current = input;

  useEffect(() => {
    /* Workspace event stream stays global because projects/settings/providers can change without active project scope. */
    let disposed = false;
    let reconnectDelayMs = INITIAL_WS_RECONNECT_DELAY_MS;
    let ws: WebSocket | null = null;

    const clearRefreshTimer = (kind: RefreshKind): void => {
      /* One debounce timer per surface prevents bursty workspace events from spamming duplicate reloads. */
      const timerId = refreshTimersRef.current[kind];
      if (timerId !== null) {
        window.clearTimeout(timerId);
        refreshTimersRef.current[kind] = null;
      }
    };

    const clearReconnectTimer = (): void => {
      /* Reconnect timers must be unique so backend restarts cannot stack duplicate reconnect attempts. */
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const runRefresh = (kind: RefreshKind): void => {
      /* Surface refresh routing stays explicit so each live event only touches the minimum required loaders. */
      const current = inputRef.current;

      if (kind === "projects") {
        void current.onProjectsChanged();
        return;
      }

      if (kind === "providers") {
        if (current.activeTab === "providers") {
          void current.onProvidersChanged();
        }
        return;
      }

      if (kind === "settings") {
        if (current.activeTab === "settings") {
          void current.onSettingsChanged(current.activeId);
        }
        return;
      }

      if (!current.activeId) {
        return;
      }

      if (kind === "git" && current.activeTab === "github") {
        void current.onGitChanged(current.activeId);
        return;
      }

      if (kind === "files" && current.activeTab === "files") {
        void current.onFilesChanged(current.activeId, current.filePath);
      }
    };

    const scheduleRefresh = (kind: RefreshKind): void => {
      /* Short debounce keeps multi-surface mutations from issuing overlapping loaders immediately. */
      clearRefreshTimer(kind);
      refreshTimersRef.current[kind] = window.setTimeout(() => {
        refreshTimersRef.current[kind] = null;
        runRefresh(kind);
      }, LIVE_REFRESH_DEBOUNCE_MS);
    };

    const scheduleReconnect = (): void => {
      /* Failed handshakes and backend restarts should degrade into bounded retries, not a dead live sync. */
      if (disposed || reconnectTimerRef.current !== null) {
        return;
      }

      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        void connect();
      }, reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_WS_RECONNECT_DELAY_MS);
    };

    const connect = async (): Promise<void> => {
      /* Every reconnect fetches a fresh token because websocket auth is short-lived and request-scoped. */
      try {
        const url = await getEventStreamUrl({ topics: ["workspace"] });
        if (disposed) {
          return;
        }

        ws = new WebSocket(url);
        ws.onopen = () => {
          /* Healthy socket resets backoff and clears pending reconnects. */
          reconnectDelayMs = INITIAL_WS_RECONNECT_DELAY_MS;
          clearReconnectTimer();
        };
        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data) as WorkspaceStateChangedEvent;
            if (payload.type !== "workspace.state.changed") {
              return;
            }

            const current = inputRef.current;
            const eventProjectSlug = typeof payload.data?.projectSlug === "string" ? payload.data.projectSlug.trim() : "";
            const currentProjectSlug = current.activeId?.trim() ?? "";
            const surfaces = Array.isArray(payload.data?.surfaces) ? payload.data.surfaces : [];

            surfaces.forEach((surface) => {
              if (surface === "projects" || surface === "providers") {
                scheduleRefresh(surface);
                return;
              }

              if (surface === "settings") {
                if (!eventProjectSlug || !currentProjectSlug || eventProjectSlug === currentProjectSlug) {
                  scheduleRefresh(surface);
                }
                return;
              }

              if (!currentProjectSlug || !eventProjectSlug || eventProjectSlug !== currentProjectSlug) {
                return;
              }

              scheduleRefresh(surface);
            });
          } catch {
            /* Malformed or unrelated socket frames should never break workspace live sync. */
          }
        };
        ws.onerror = () => {
          /* Transport issues fall through into onclose-driven reconnects. */
        };
        ws.onclose = () => {
          ws = null;
          scheduleReconnect();
        };
      } catch {
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      disposed = true;
      (Object.keys(refreshTimersRef.current) as RefreshKind[]).forEach((kind) => clearRefreshTimer(kind));
      clearReconnectTimer();
      ws?.close();
    };
  }, []);
};
