/**
 * @fileoverview Runtime deploy/settings actions for project cards and settings accordion.
 *
 * Exports:
 * - useProjectRuntime (L21) - Loads runtime snapshot and exposes deploy/start/stop actions.
 */

import { useRef, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import { ProjectRuntimeMode, ProjectRuntimeSettingsPatch, ProjectRuntimeSnapshot } from "../types";

type RefreshProjects = () => Promise<void>;

export const useProjectRuntime = (
  setError: (value: string | null) => void,
  refreshProjects: RefreshProjects
) => {
  const [runtime, setRuntime] = useState<ProjectRuntimeSnapshot | null>(null);
  const [isRuntimeLoading, setIsRuntimeLoading] = useState<boolean>(false);
  const [isRuntimeSaving, setIsRuntimeSaving] = useState<boolean>(false);
  const loadRuntimeSeq = useRef<number>(0);

  const saveSettings = async (projectId: string, patch: ProjectRuntimeSettingsPatch): Promise<void> => {
    /* Save runtime settings patch and refresh project cards once backend accepts update. */
    setError(null);
    setIsRuntimeSaving(true);
    try {
      const snapshot = await apiPost<ProjectRuntimeSnapshot>(`/api/projects/${projectId}/deploy/settings`, patch);
      setRuntime(snapshot);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to save deploy settings");
      setIsRuntimeSaving(false);
      return;
    }

    try {
      await refreshProjects();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Deploy settings saved, but projects refresh failed");
    } finally {
      setIsRuntimeSaving(false);
    }
  };

  const loadRuntime = async (projectId: string | null): Promise<void> => {
    /* Load runtime settings for selected project and clear stale state on null selection. */
    const seq = loadRuntimeSeq.current + 1;
    loadRuntimeSeq.current = seq;

    if (!projectId) {
      if (seq === loadRuntimeSeq.current) {
        setError(null);
        setRuntime(null);
        setIsRuntimeLoading(false);
      }
      return;
    }

    try {
      if (seq === loadRuntimeSeq.current) {
        setError(null);
        setIsRuntimeLoading(true);
      }
      const snapshot = await apiGet<ProjectRuntimeSnapshot>(`/api/projects/${projectId}/deploy/settings`);
      if (seq === loadRuntimeSeq.current) {
        setRuntime(snapshot);
      }
    } catch (error) {
      if (seq === loadRuntimeSeq.current) {
        setError(error instanceof Error ? error.message : "Failed to load deploy settings");
        setRuntime(null);
      }
    } finally {
      if (seq === loadRuntimeSeq.current) {
        setIsRuntimeLoading(false);
      }
    }
  };

  const saveMode = async (projectId: string, mode: ProjectRuntimeMode): Promise<void> => {
    /* Persist selected runtime mode and refresh local runtime snapshot. */
    await saveSettings(projectId, { mode });
  };

  const deployStart = async (projectId: string): Promise<void> => {
    /* Start public deployment for project and refresh project cards. */
    setError(null);
    setIsRuntimeSaving(true);
    try {
      const snapshot = await apiPost<ProjectRuntimeSnapshot>(`/api/projects/${projectId}/deploy/start`, {});
      setRuntime(snapshot);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to deploy project");
      setIsRuntimeSaving(false);
      return;
    }

    try {
      await refreshProjects();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Project deployed, but projects refresh failed");
    } finally {
      setIsRuntimeSaving(false);
    }
  };

  const deployStop = async (projectId: string): Promise<void> => {
    /* Stop public deployment for project and refresh project cards. */
    setError(null);
    setIsRuntimeSaving(true);
    try {
      const snapshot = await apiPost<ProjectRuntimeSnapshot>(`/api/projects/${projectId}/deploy/stop`, {});
      setRuntime(snapshot);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to stop deploy");
      setIsRuntimeSaving(false);
      return;
    }

    try {
      await refreshProjects();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Deploy stopped, but projects refresh failed");
    } finally {
      setIsRuntimeSaving(false);
    }
  };

  return {
    runtime,
    isRuntimeLoading,
    isRuntimeSaving,
    loadRuntime,
    saveSettings,
    saveMode,
    deployStart,
    deployStop
  };
};
