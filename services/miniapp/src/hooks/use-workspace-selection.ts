/**
 * @fileoverview Active project selection and restore flow for the workspace shell.
 *
 * Exports:
 * - useWorkspaceSelection - Restores and switches the active workspace project with related UI cleanup.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import { TabKey } from "../components/WorkspaceHeader";
import { ProjectRecord } from "../types";
import { readTabPersistenceState } from "./use-tab-memory";

const STORAGE_KEY_ACTIVE_PROJECT = "tvoc.miniapp.activeProject";

export const useWorkspaceSelection = (input: {
  projects: ProjectRecord[];
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  loadFiles: (projectId: string, path: string) => Promise<void> | void;
  loadStatus: (projectId: string) => Promise<void> | void;
  loadGitOverview: (projectId: string) => Promise<void> | void;
  closeFilePreview: () => void;
  setSettingsActiveFile: (value: null) => void;
  clearTerminalBuffer: () => void;
  clearLogs: (projectId: string) => void;
  setError: (value: string | null) => void;
}) => {
  const {
    projects,
    activeTab,
    setActiveTab,
    loadFiles,
    loadStatus,
    loadGitOverview,
    closeFilePreview,
    setSettingsActiveFile,
    clearTerminalBuffer,
    clearLogs,
    setError
  } = input;
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY_ACTIVE_PROJECT));

  const activeProject = useMemo(() => {
    /* Keep active project lookup derived from the latest catalog so stale ids resolve to null safely. */
    if (!activeId) {
      return null;
    }

    return projects.find((project) => project.id === activeId) ?? null;
  }, [activeId, projects]);

  const restoreActiveProject = useCallback(async (): Promise<void> => {
    /* Reopen the previous workspace selection and route the user back to their last useful tab. */
    const preferredWorkspaceTab = readTabPersistenceState().lastWorkspaceTab;

    try {
      const serverActive = await apiGet<ProjectRecord | null>("/api/projects/active");
        const slug = serverActive?.id ?? null;
        if (slug) {
          setActiveId(slug);
          localStorage.setItem(STORAGE_KEY_ACTIVE_PROJECT, slug);
          setActiveTab(preferredWorkspaceTab);
          if (preferredWorkspaceTab === "files") {
            void loadFiles(slug, "");
          }
          return;
        }
    } catch {
      /* Local storage fallback keeps browser refreshes usable while backend recovers. */
    }

    if (activeId) {
      setActiveTab(preferredWorkspaceTab);
      if (preferredWorkspaceTab === "files") {
        void loadFiles(activeId, "");
      }
    }
  }, [activeId, loadFiles, setActiveTab]);

  const selectProject = useCallback(
    async (projectId: string): Promise<void> => {
      /* Project switches preserve the current workspace tab and clear stale file/log/terminal state. */
      const preferredWorkspaceTab = readTabPersistenceState().lastWorkspaceTab;
      const nextTab = activeTab === "projects" ? preferredWorkspaceTab : activeTab;

      try {
        setError(null);
        await apiPost(`/api/projects/${projectId}/select`, {});
        setActiveId(projectId);
        setActiveTab(nextTab);

        const selected = projects.find((project) => project.id === projectId) ?? null;
        if (selected?.runnable) {
          void loadStatus(projectId);
        }
        void loadGitOverview(projectId);

        if (nextTab === "files") {
          void loadFiles(projectId, "");
        }

        closeFilePreview();
        setSettingsActiveFile(null);
        clearLogs(projectId);
        clearTerminalBuffer();

        localStorage.setItem(STORAGE_KEY_ACTIVE_PROJECT, projectId);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to select project");
      }
    },
    [activeTab, clearLogs, clearTerminalBuffer, closeFilePreview, loadFiles, loadGitOverview, loadStatus, projects, setActiveTab, setError, setSettingsActiveFile]
  );

  useEffect(() => {
    /* Persisting selection inside the hook keeps App free from storage bookkeeping noise. */
    if (activeId) {
      localStorage.setItem(STORAGE_KEY_ACTIVE_PROJECT, activeId);
      return;
    }

    localStorage.removeItem(STORAGE_KEY_ACTIVE_PROJECT);
  }, [activeId]);

  return {
    activeId,
    setActiveId,
    activeProject,
    restoreActiveProject,
    selectProject
  };
};
