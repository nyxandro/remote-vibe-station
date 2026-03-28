/**
 * @fileoverview Hook for runtime service health dashboard and restart actions.
 *
 * Exports:
 * - useRuntimeServices - Loads runtime health snapshot and restarts one managed service.
 */

import { useCallback, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import { ManagedRuntimeServiceId, RuntimeServicesSnapshot } from "../types";

export const useRuntimeServices = (setError: (value: string | null) => void) => {
  const [snapshot, setSnapshot] = useState<RuntimeServicesSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [restartingByService, setRestartingByService] = useState<Partial<Record<ManagedRuntimeServiceId, boolean>>>({});

  const loadSnapshot = useCallback(async (): Promise<void> => {
    /* Settings dashboard needs one normalized payload for all critical runtime services. */
    try {
      setError(null);
      setIsLoading(true);
      const data = await apiGet<RuntimeServicesSnapshot>("/api/telegram/system/services");
      setSnapshot(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load runtime services health");
    } finally {
      setIsLoading(false);
    }
  }, [setError]);

  const restartService = useCallback(
    async (serviceId: ManagedRuntimeServiceId): Promise<void> => {
      /* Per-service restart state keeps each modal action deterministic and avoids double submits. */
      try {
        setError(null);
        setRestartingByService((prev) => ({ ...prev, [serviceId]: true }));
        await apiPost(`/api/telegram/system/services/${serviceId}/restart`, {});
        await loadSnapshot();
      } catch (error) {
        setError(error instanceof Error ? error.message : `Failed to restart runtime service '${serviceId}'`);
      } finally {
        setRestartingByService((prev) => ({ ...prev, [serviceId]: false }));
      }
    },
    [loadSnapshot, setError]
  );

  return {
    snapshot,
    isLoading,
    restartingByService,
    loadSnapshot,
    restartService
  };
};
