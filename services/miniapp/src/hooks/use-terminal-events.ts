/**
 * @fileoverview Terminal event buffering from backend WS.
 *
 * Exports:
 * - useTerminalEvents (L18) - Subscribes to /events and buffers output for active project.
 */

import { useEffect, useState } from "react";

import { getEventStreamUrl } from "../api/client";
import { sanitizeTerminalChunk } from "../utils/terminal-output";

const MAX_BUFFER_CHARS = 20_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

export const useTerminalEvents = (activeId: string | null) => {
  /* Keep terminal output buffered for the selected project. */
  const [terminalBuffer, setTerminalBuffer] = useState<string>("");

  useEffect(() => {
    /* Terminal stream stays disabled until one concrete project scope is selected. */
    if (!activeId) {
      return;
    }

    let disposed = false;
    let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
    let reconnectTimer: number | null = null;
    let ws: WebSocket | null = null;

    const clearReconnectTimer = () => {
      /* Only one retry timer should survive at a time across reconnects and effect teardown. */
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      /* Backend restarts should degrade into retry/backoff rather than a dead terminal tab. */
      if (disposed || reconnectTimer !== null) {
        return;
      }

      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, reconnectDelayMs);
      reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    };

    const connect = async () => {
      /* Each reconnect fetches a fresh WS token so short-lived auth never expires mid-retry loop. */
      try {
        const url = await getEventStreamUrl({ topics: ["terminal"], projectSlug: activeId });
        if (disposed) {
          return;
        }

        ws = new WebSocket(url);
        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data) as any;
            if (payload?.type !== "terminal.output") {
              return;
            }

            const slug = payload?.data?.slug as string | undefined;
            const chunk = payload?.data?.chunk as string | undefined;
            if (!slug || !chunk || slug !== activeId) {
              return;
            }

            /* Render PTY output as plain text, so terminal control bytes must be stripped. */
            const safeChunk = sanitizeTerminalChunk(chunk);
            if (!safeChunk) {
              return;
            }

            setTerminalBuffer((prev) => (prev + safeChunk).slice(-MAX_BUFFER_CHARS));
          } catch {
            /* Malformed or unrelated socket messages should not break the active terminal session. */
          }
        };
        ws.onopen = () => {
          /* Successful reconnect resets backoff so later network blips recover quickly again. */
          reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
          clearReconnectTimer();
        };
        ws.onclose = () => {
          ws = null;
          scheduleReconnect();
        };
        ws.onerror = () => {
          /* Transport errors are handled by onclose-driven reconnect flow. */
        };
      } catch {
        scheduleReconnect();
      }
    };

    void connect();

    return () => {
      disposed = true;
      clearReconnectTimer();
      ws?.close();
    };
  }, [activeId]);

  return {
    terminalBuffer,
    clearTerminalBuffer: () => setTerminalBuffer("")
  };
};
