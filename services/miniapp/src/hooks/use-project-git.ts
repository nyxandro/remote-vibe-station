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
type InvalidateProjectCatalog = (projectId: string) => Promise<void> | void;

export const useProjectGit = (
  setError: (value: string | null) => void,
  invalidateProjectCatalog?: InvalidateProjectCatalog
) => {
  const [gitOverviewMap, setGitOverviewMap] = useState<GitOverviewMap>({});

  const setOverview = useCallback((projectId: string, overview: GitOverview | null): void => {
    /* Keep map updates centralized for deterministic rerenders. */
    setGitOverviewMap((prev) => ({ ...prev, [projectId]: overview }));
  }, []);

  const applyMutationOverview = useCallback(
    async (
      projectId: string,
      request: () => Promise<GitOverview | null>,
      fallbackMessage: string
    ): Promise<void> => {
      /* Git mutations should update the active tab immediately and invalidate Projects cards right after success. */
      try {
        setError(null);
        const overview = await request();
        setOverview(projectId, overview);
        if (invalidateProjectCatalog) {
          try {
            await invalidateProjectCatalog(projectId);
          } catch (error) {
            console.error("Project catalog invalidation failed after git mutation", error);
          }
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : fallbackMessage);
      }
    },
    [invalidateProjectCatalog, setError, setOverview]
  );

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
    /* Execute simple git operation and refresh both local tab state and project-card summaries. */
    await applyMutationOverview(
      projectId,
      () => apiPost<GitOverview | null>(`/api/projects/${projectId}/git/${operation}`, {}),
      `Failed to run git ${operation}`
    );
  }, [applyMutationOverview]);

  const checkoutBranch = useCallback(async (projectId: string, branch: string): Promise<void> => {
    /* Switch active branch and invalidate project summary metadata that shows the current branch. */
    await applyMutationOverview(
      projectId,
      () => apiPost<GitOverview | null>(`/api/projects/${projectId}/git/checkout`, { branch }),
      "Failed to checkout branch"
    );
  }, [applyMutationOverview]);

  const mergeBranch = useCallback(async (projectId: string, sourceBranch: string): Promise<void> => {
    /* Merge source branch into current branch and keep project cards in sync with the new repo state. */
    await applyMutationOverview(
      projectId,
      () =>
        apiPost<GitOverview | null>(`/api/projects/${projectId}/git/merge`, {
          sourceBranch
        }),
      "Failed to merge branch"
    );
  }, [applyMutationOverview]);

  const commitAll = useCallback(async (projectId: string, message: string): Promise<void> => {
    /* Commit should clear/change local file badges and refresh project-level git summary immediately. */
    await applyMutationOverview(
      projectId,
      () => apiPost<GitOverview | null>(`/api/projects/${projectId}/git/commit`, { message }),
      "Failed to commit changes"
    );
  }, [applyMutationOverview]);

  return {
    gitOverviewMap,
    loadGitOverview,
    runGitOperation,
    checkoutBranch,
    mergeBranch,
    commitAll
  };
};
