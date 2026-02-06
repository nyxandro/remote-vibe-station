/**
 * @fileoverview Polling hook for container status in selected project.
 *
 * Exports:
 * - useContainerStatusPolling (L20) - Triggers immediate + interval polling while project is runnable.
 */

import { useEffect, useRef } from "react";

type UseContainerStatusPollingOptions = {
  projectId: string | null;
  isRunnable: boolean;
  onPoll: (projectId: string) => void;
  pollIntervalMs?: number;
};

const DEFAULT_POLL_INTERVAL_MS = 8000;

export const useContainerStatusPolling = (options: UseContainerStatusPollingOptions): void => {
  const pollRef = useRef(options.onPoll);

  /* Keep latest callback without forcing the polling effect to restart every render. */
  useEffect(() => {
    pollRef.current = options.onPoll;
  }, [options.onPoll]);

  useEffect(() => {
    /* Poll only for selected runnable projects. */
    if (!options.projectId || !options.isRunnable) {
      return;
    }
    const projectId = options.projectId;

    /* Run immediately to avoid waiting for the first interval tick. */
    pollRef.current(projectId);

    const intervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timer = window.setInterval(() => {
      pollRef.current(projectId);
    }, intervalMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [options.projectId, options.isRunnable, options.pollIntervalMs]);
};
