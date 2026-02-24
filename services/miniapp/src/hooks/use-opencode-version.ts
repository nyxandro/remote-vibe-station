/**
 * @fileoverview OpenCode version status/actions for Settings tab.
 *
 * Exports:
 * - useOpenCodeVersion (L16) - Loads latest/current versions and triggers updates.
 */

import { useCallback, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import { OpenCodeVersionStatus, OpenCodeVersionUpdateResult } from "../types";

export const useOpenCodeVersion = (setError: (value: string | null) => void) => {
  const [status, setStatus] = useState<OpenCodeVersionStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);

  const loadStatus = useCallback(async (): Promise<void> => {
    /* Load cached version snapshot without forcing npm registry check. */
    try {
      setError(null);
      setIsLoading(true);
      const data = await apiGet<OpenCodeVersionStatus>("/api/opencode/version/status");
      setStatus(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load OpenCode version status");
    } finally {
      setIsLoading(false);
    }
  }, [setError]);

  const checkStatus = useCallback(async (): Promise<void> => {
    /* Force latest-version refresh used by Settings Reload action. */
    try {
      setError(null);
      setIsLoading(true);
      const data = await apiPost<OpenCodeVersionStatus>("/api/opencode/version/check", {});
      setStatus(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to check OpenCode version");
    } finally {
      setIsLoading(false);
    }
  }, [setError]);

  const updateNow = useCallback(async (): Promise<void> => {
    /* Update OpenCode runtime to latest version and refresh local status. */
    if (isUpdating) {
      return;
    }

    try {
      setError(null);
      setIsUpdating(true);
      const result = await apiPost<OpenCodeVersionUpdateResult>("/api/opencode/version/update", {});
      setStatus(result.after);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to update OpenCode");
    } finally {
      setIsUpdating(false);
    }
  }, [isUpdating, setError]);

  return {
    status,
    isLoading,
    isUpdating,
    loadStatus,
    checkStatus,
    updateNow
  };
};
