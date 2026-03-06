/**
 * @fileoverview Settings hook for loading backend server diagnostics metrics.
 *
 * Exports:
 * - useServerMetrics - Loads CPU/RAM/disk/network snapshot for Settings accordion.
 */

import { useCallback, useState } from "react";

import { apiGet } from "../api/client";
import { SystemMetricsSnapshot } from "../types";

export const useServerMetrics = (setError: (value: string | null) => void) => {
  const [metrics, setMetrics] = useState<SystemMetricsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const loadMetrics = useCallback(async (): Promise<void> => {
    /* Settings should expose current server capacity with explicit reload action. */
    try {
      setError(null);
      setIsLoading(true);
      const data = await apiGet<SystemMetricsSnapshot>("/api/telegram/system/metrics");
      setMetrics(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load server metrics");
    } finally {
      setIsLoading(false);
    }
  }, [setError]);

  return {
    metrics,
    isLoading,
    loadMetrics
  };
};
