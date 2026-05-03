/**
 * @fileoverview Hook for runtime version checks, updates and rollback actions.
 *
 * Exports:
 * - useRuntimeVersion - Loads current runtime version and runs update/rollback operations.
 */

import { useCallback, useEffect, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import { RuntimeUpdateResult, RuntimeUpdateState, RuntimeVersionSnapshot } from "../types";

const UPDATE_STATUS_POLL_MS = 3000;

export const useRuntimeVersion = (setError: (value: string | null) => void) => {
  const [snapshot, setSnapshot] = useState<RuntimeVersionSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [isRollingBack, setIsRollingBack] = useState<boolean>(false);
  const [isReconnecting, setIsReconnecting] = useState<boolean>(false);
  const [lastResult, setLastResult] = useState<"idle" | "updated" | "rolled-back" | "noop">("idle");
  const [updateState, setUpdateState] = useState<RuntimeUpdateState | null>(null);

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

  const loadUpdateState = useCallback(async (): Promise<void> => {
    /* Update state is persisted by backend so reconnects after service restart can recover progress. */
    try {
      const state = await apiGet<RuntimeUpdateState>("/api/telegram/system/runtime/update/state");
      setUpdateState(state);
      setIsReconnecting(false);
      if (state.status === "completed") {
        await loadSnapshot();
      }
    } catch (error) {
      const isExpectedRestart = updateState?.status === "updating" || updateState?.status === "restarting" || isUpdating;
      if (isExpectedRestart) {
        setIsReconnecting(true);
        return;
      }
      setError(error instanceof Error ? error.message : "Failed to load runtime update status");
    }
  }, [isUpdating, loadSnapshot, setError, updateState?.status]);

  const checkLatest = useCallback(async (): Promise<void> => {
    /* Operator-triggered check avoids background network noise in Telegram WebView. */
    try {
      setError(null);
      setIsChecking(true);
      setSnapshot(await apiPost<RuntimeVersionSnapshot>("/api/telegram/system/runtime/version/check", {}));
      await loadUpdateState();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to check runtime updates");
    } finally {
      setIsChecking(false);
    }
  }, [loadUpdateState, setError]);

  const updateRuntime = useCallback(async (): Promise<void> => {
    /* Backend owns update sequencing because Mini App may be restarted by the operation itself. */
    try {
      setError(null);
      setIsUpdating(true);
      const result = await apiPost<RuntimeUpdateResult>("/api/telegram/system/runtime/update", {});
      setSnapshot(result.current);
      setLastResult(result.applied ? "updated" : "noop");
    } catch (error) {
      setIsReconnecting(true);
      setUpdateState((prev) => prev ?? {
        status: "restarting",
        currentVersion: snapshot?.currentVersion ?? null,
        targetVersion: snapshot?.latestVersion ?? null,
        targetImageTag: snapshot?.latestImageTag ?? null,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: null,
        steps: []
      });
    } finally {
      setIsUpdating(false);
    }
  }, [setError, snapshot?.currentVersion, snapshot?.latestImageTag, snapshot?.latestVersion]);

  const rollbackRuntime = useCallback(async (): Promise<void> => {
    /* Rollback restores .env.previous through backend and then refreshes the visible snapshot. */
    try {
      setError(null);
      setIsRollingBack(true);
      const result = await apiPost<RuntimeUpdateResult>("/api/telegram/system/runtime/rollback", {});
      setSnapshot(result.current);
      setLastResult("rolled-back");
      await loadUpdateState();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to rollback runtime");
    } finally {
      setIsRollingBack(false);
    }
  }, [loadUpdateState, setError]);

  useEffect(() => {
    /* During restart, API outages are expected; keep polling until backend answers again. */
    const shouldPoll = isReconnecting || updateState?.status === "updating" || updateState?.status === "restarting";
    if (!shouldPoll) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadUpdateState();
    }, UPDATE_STATUS_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, [isReconnecting, loadUpdateState, updateState?.status]);

  return {
    snapshot,
    isLoading,
    isChecking,
    isUpdating,
    isRollingBack,
    isReconnecting,
    lastResult,
    updateState,
    loadSnapshot,
    loadUpdateState,
    checkLatest,
    updateRuntime,
    rollbackRuntime
  };
};
