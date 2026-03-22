/**
 * @fileoverview OpenCode admin orchestration helpers for the Settings tab.
 *
 * Exports:
 * - useOpenCodeAdminActions - Wraps sync/restart/reload flows with shared error and status handling.
 */

import { useCallback, useState } from "react";

import { apiPost } from "../api/client";

export const useOpenCodeAdminActions = (input: {
  setError: (value: string | null) => void;
  activeId: string | null;
  loadProjects: () => Promise<void>;
  loadSettingsOverview: (projectId: string | null) => Promise<void>;
  checkOpenCodeVersionStatus: () => Promise<void>;
  refreshSettingsSurface?: (projectId: string | null) => Promise<void>;
}) => {
  const [restartOpenCodeState, setRestartOpenCodeState] = useState<{
    isRestarting: boolean;
    lastResult: "idle" | "success" | "error";
  }>({ isRestarting: false, lastResult: "idle" });
  const {
    setError,
    activeId,
    loadProjects,
    loadSettingsOverview,
    checkOpenCodeVersionStatus,
    refreshSettingsSurface
  } = input;

  const refreshSettingsNow = useCallback(async (): Promise<void> => {
    /* Admin reload/restart should refresh the entire visible Settings surface when that helper is available. */
    if (refreshSettingsSurface) {
      await refreshSettingsSurface(activeId);
      return;
    }

    await Promise.all([loadSettingsOverview(activeId), checkOpenCodeVersionStatus()]);
  }, [activeId, checkOpenCodeVersionStatus, loadSettingsOverview, refreshSettingsSurface]);

  const syncOpenCodeAtStartup = useCallback(async (): Promise<void> => {
    /* Startup sync stays silent because the shell must still boot when OpenCode warm-up lags behind. */
    try {
      await apiPost("/api/opencode/sync-projects", {});
    } catch {
      /* Startup flow intentionally ignores sync errors and lets the user recover later from Settings. */
    }
  }, []);

  const syncOpenCodeNow = useCallback(async (): Promise<void> => {
    /* Manual sync should refresh the project list once the backend confirms completion. */
    try {
      setError(null);
      await apiPost("/api/opencode/sync-projects", {});
      await loadProjects();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to sync OpenCode projects");
    }
  }, [loadProjects, setError]);

  const restartOpenCodeNow = useCallback(async (): Promise<void> => {
    /* Restart state is tracked explicitly so Settings can render success/error banners deterministically. */
    setRestartOpenCodeState({ isRestarting: true, lastResult: "idle" });
    try {
      setError(null);
      await apiPost("/api/opencode/restart", {});
      await refreshSettingsNow();
      setRestartOpenCodeState({ isRestarting: false, lastResult: "success" });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to restart OpenCode");
      setRestartOpenCodeState({ isRestarting: false, lastResult: "error" });
    }
  }, [refreshSettingsNow, setError]);

  const reloadSettingsNow = useCallback(async (): Promise<void> => {
    /* Settings reload groups config overview and version refresh into one operator action. */
    try {
      setError(null);
      await refreshSettingsNow();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to reload OpenCode settings");
    }
  }, [refreshSettingsNow, setError]);

  return {
    restartOpenCodeState,
    syncOpenCodeAtStartup,
    syncOpenCodeNow,
    restartOpenCodeNow,
    reloadSettingsNow
  };
};
