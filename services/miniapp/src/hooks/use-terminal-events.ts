/**
 * @fileoverview Terminal event buffering from backend WS.
 *
 * Exports:
 * - useTerminalEvents (L18) - Subscribes to /events and buffers output for active project.
 */

import { useEffect, useState } from "react";

import { sanitizeTerminalChunk } from "../utils/terminal-output";

const MAX_BUFFER_CHARS = 20_000;

export const useTerminalEvents = (activeId: string | null) => {
  /* Keep terminal output buffered for the selected project. */
  const [terminalBuffer, setTerminalBuffer] = useState<string>("");

  useEffect(() => {
    /* Connect via same-origin /events proxy (nginx) for stability. */
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/events`);

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as any;
        if (payload?.type !== "terminal.output") {
          return;
        }

        const slug = payload?.data?.slug as string | undefined;
        const chunk = payload?.data?.chunk as string | undefined;
        if (!slug || !chunk) {
          return;
        }

        /* Render PTY output as plain text, so terminal control bytes must be stripped. */
        const safeChunk = sanitizeTerminalChunk(chunk);
        if (!safeChunk) {
          return;
        }

        if (activeId && slug === activeId) {
          setTerminalBuffer((prev) => (prev + safeChunk).slice(-MAX_BUFFER_CHARS));
        }
      } catch {
        // Ignore malformed messages.
      }
    };

    return () => ws.close();
  }, [activeId]);

  return {
    terminalBuffer,
    clearTerminalBuffer: () => setTerminalBuffer("")
  };
};
