/**
 * @fileoverview GitHub tab state/actions for project-scoped git operations.
 *
 * Exports:
 * - GitOperation (L13) - Supported git control actions.
 * - useProjectGit (L22) - Loads git overview and executes git actions per project.
 */

import { useCallback, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import { GitOverview } from "../types";

export type GitOperation = "fetch" | "pull" | "push";

type GitOverviewMap = Record<string, GitOverview | null>;

export const useProjectGit = (setError: (value: string | null) => void) => {
  const [gitOverviewMap, setGitOverviewMap] = useState<GitOverviewMap>({});

  const setOverview = useCallback((projectId: string, overview: GitOverview | null): void => {
    /* Keep map updates centralized for deterministic rerenders. */
    setGitOverviewMap((prev) => ({ ...prev, [projectId]: overview }));
  }, []);

  const loadGitOverview = useCallback(async (projectId: string): Promise<void> => {
    /* Fetch current branch + file status overview for the selected project. */
    try {
      setError(null);
      const overview = await apiGet<GitOverview | null>(`/api/projects/${projectId}/git/overview`);
      setOverview(projectId, overview);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load git overview");
    }
  }, [setError, setOverview]);

  const runGitOperation = useCallback(async (projectId: string, operation: GitOperation): Promise<void> => {
    /* Execute simple git operation and refresh overview snapshot. */
    try {
      setError(null);
      const overview = await apiPost<GitOverview | null>(`/api/projects/${projectId}/git/${operation}`, {});
      setOverview(projectId, overview);
    } catch (error) {
      setError(error instanceof Error ? error.message : `Failed to run git ${operation}`);
    }
  }, [setError, setOverview]);

  const checkoutBranch = useCallback(async (projectId: string, branch: string): Promise<void> => {
    /* Switch active branch and refresh overview. */
    try {
      setError(null);
      const overview = await apiPost<GitOverview | null>(`/api/projects/${projectId}/git/checkout`, { branch });
      setOverview(projectId, overview);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to checkout branch");
    }
  }, [setError, setOverview]);

  const mergeBranch = useCallback(async (projectId: string, sourceBranch: string): Promise<void> => {
    /* Merge source branch into current branch and refresh overview. */
    try {
      setError(null);
      const overview = await apiPost<GitOverview | null>(`/api/projects/${projectId}/git/merge`, {
        sourceBranch
      });
      setOverview(projectId, overview);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to merge branch");
    }
  }, [setError, setOverview]);

  const commitAll = useCallback(async (projectId: string, message: string): Promise<void> => {
    /* Commit pending changes and refresh overview. */
    try {
      setError(null);
      const overview = await apiPost<GitOverview | null>(`/api/projects/${projectId}/git/commit`, { message });
      setOverview(projectId, overview);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to commit changes");
    }
  }, [setError, setOverview]);

  return {
    gitOverviewMap,
    loadGitOverview,
    runGitOperation,
    checkoutBranch,
    mergeBranch,
    commitAll
  };
};
