/**
 * @fileoverview Workspace project creation/deletion actions for Projects/Settings tabs.
 *
 * Exports:
 * - useProjectWorkspace (L14) - Provides create/clone/delete actions with error propagation.
 */

import { apiPost } from "../api/client";

type RefreshProjects = () => Promise<void>;

export const useProjectWorkspace = (
  setError: (value: string | null) => void,
  refreshProjects: RefreshProjects,
  clearActiveSelection: () => void
) => {
  const createProjectFolder = async (name: string): Promise<void> => {
    /* Create local project folder then refresh list. */
    try {
      setError(null);
      await apiPost("/api/projects/create-folder", { name });
      await refreshProjects();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to create project folder");
    }
  };

  const cloneProjectRepository = async (repositoryUrl: string, folderName?: string): Promise<void> => {
    /* Clone repository into projects root then refresh list. */
    try {
      setError(null);
      await apiPost("/api/projects/clone", { repositoryUrl, folderName });
      await refreshProjects();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to clone repository");
    }
  };

  const deleteProjectFolder = async (projectId: string): Promise<void> => {
    /* Delete selected project folder and clear local active selection. */
    try {
      setError(null);
      await apiPost(`/api/projects/${projectId}/delete`, {});
      clearActiveSelection();
      await refreshProjects();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to delete project");
    }
  };

  return { createProjectFolder, cloneProjectRepository, deleteProjectFolder };
};
