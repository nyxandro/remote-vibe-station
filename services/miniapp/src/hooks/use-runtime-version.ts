/**
 * @fileoverview Hook for runtime version checks, updates and rollback actions.
 *
 * Exports:
 * - useRuntimeVersion - Loads current runtime version and runs update/rollback operations.
 */

import { useCallback, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import { RuntimeUpdateResult, RuntimeVersionSnapshot } from "../types";

export const useRuntimeVersion = (setError: (value: string | null) => void) => {
  const [snapshot, setSnapshot] = useState<RuntimeVersionSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [isRollingBack, setIsRollingBack] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<"idle" | "updated" | "rolled-back" | "noop">("idle");

  const loadSnapshot = useCallback(async (): Promise<void> => {
    /* Settings needs local version state even when GitHub release checks are unavailable. */
    try {
      setError(null);
      setIsLoading(true);
      setSnapshot(await apiGet<RuntimeVersionSnapshot>("/api/telegram/system/runtime/version"));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load runtime version");
    } finally {
      setIsLoading(false);
    }
  }, [setError]);

  const checkLatest = useCallback(async (): Promise<void> => {
    /* Operator-triggered check avoids background network noise in Telegram WebView. */
    try {
      setError(null);
      setIsChecking(true);
      setSnapshot(await apiPost<RuntimeVersionSnapshot>("/api/telegram/system/runtime/version/check", {}));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to check runtime updates");
    } finally {
      setIsChecking(false);
    }
  }, [setError]);

  const updateRuntime = useCallback(async (): Promise<void> => {
    /* Backend owns update sequencing because Mini App may be restarted by the operation itself. */
    try {
      setError(null);
      setIsUpdating(true);
      const result = await apiPost<RuntimeUpdateResult>("/api/telegram/system/runtime/update", {});
      setSnapshot(result.current);
      setLastResult(result.applied ? "updated" : "noop");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to update runtime");
    } finally {
      setIsUpdating(false);
    }
  }, [setError]);

  const rollbackRuntime = useCallback(async (): Promise<void> => {
    /* Rollback restores .env.previous through backend and then refreshes the visible snapshot. */
    try {
      setError(null);
      setIsRollingBack(true);
      const result = await apiPost<RuntimeUpdateResult>("/api/telegram/system/runtime/rollback", {});
      setSnapshot(result.current);
      setLastResult("rolled-back");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to rollback runtime");
    } finally {
      setIsRollingBack(false);
    }
  }, [setError]);

  return {
    snapshot,
    isLoading,
    isChecking,
    isUpdating,
    isRollingBack,
    lastResult,
    loadSnapshot,
    checkLatest,
    updateRuntime,
    rollbackRuntime
  };
};
