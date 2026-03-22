/**
 * @fileoverview OpenCode settings data/actions for Settings accordion.
 *
 * Exports:
 * - useOpenCodeSettings (L23) - Loads overview and handles read/save/create operations.
 */

import { useCallback, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import { OpenCodeSettingsKind, OpenCodeSettingsOverview } from "../types";

type ActiveFile = {
  kind: OpenCodeSettingsKind;
  relativePath?: string;
  absolutePath: string;
  content: string;
  exists: boolean;
};

type OnSettingsChanged = (projectId: string | null) => Promise<void> | void;

export const useOpenCodeSettings = (
  setError: (value: string | null) => void,
  onSettingsChanged?: OnSettingsChanged
) => {
  const [overview, setOverview] = useState<OpenCodeSettingsOverview | null>(null);
  const [activeFile, setActiveFile] = useState<ActiveFile | null>(null);

  const loadOverview = useCallback(
    async (projectId: string | null): Promise<void> => {
      /* Refresh settings sections for selected project context. */
      try {
        setError(null);
        const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
        const data = await apiGet<OpenCodeSettingsOverview>(`/api/opencode/settings/overview${query}`);
        setOverview(data);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to load OpenCode settings");
      }
    },
    [setError]
  );

  const openFile = useCallback(
    async (
      kind: OpenCodeSettingsKind,
      projectId: string | null,
      relativePath?: string
    ): Promise<void> => {
      /* Read file content for editor surface. */
      try {
        setError(null);
        const data = await apiPost<{ exists: boolean; absolutePath: string; content: string }>(
          "/api/opencode/settings/read",
          { kind, projectId, relativePath }
        );
        setActiveFile({ kind, relativePath, ...data });
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to read settings file");
      }
    },
    [setError]
  );

  const refreshAfterSettingsMutation = useCallback(
    async (projectId: string | null): Promise<void> => {
      /* Settings mutations should refresh the accordion itself and any git/project metadata changed by file edits. */
      await loadOverview(projectId);
      if (onSettingsChanged) {
        await onSettingsChanged(projectId);
      }
    },
    [loadOverview, onSettingsChanged]
  );

  const saveActiveFile = useCallback(
    async (projectId: string | null, content: string): Promise<void> => {
      /* Persist current editor content and keep local state synchronized. */
      if (!activeFile) {
        return;
      }
      try {
        setError(null);
        await apiPost("/api/opencode/settings/save", {
          kind: activeFile.kind,
          projectId,
          relativePath: activeFile.relativePath,
          content
        });
        setActiveFile((prev) => (prev ? { ...prev, content, exists: true } : prev));
        await refreshAfterSettingsMutation(projectId);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to save settings file");
      }
    },
    [activeFile, refreshAfterSettingsMutation, setError]
  );

  const createFile = useCallback(
    async (
      kind: OpenCodeSettingsKind,
      projectId: string | null,
      name?: string
    ): Promise<void> => {
      /* Create file then open it immediately in editor. */
      try {
        setError(null);
        await apiPost("/api/opencode/settings/create", { kind, projectId, name });
        await openFile(kind, projectId, name);
        await refreshAfterSettingsMutation(projectId);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to create settings file");
      }
    },
    [openFile, refreshAfterSettingsMutation, setError]
  );

  return {
    overview,
    activeFile,
    setActiveFile,
    loadOverview,
    openFile,
    saveActiveFile,
    createFile
  };
};
