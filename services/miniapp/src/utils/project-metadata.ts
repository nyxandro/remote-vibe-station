/**
 * @fileoverview Loaders for project card metadata (containers + git summary).
 *
 * Exports:
 * - ProjectMetadataPayload (L14) - Batch metadata result for project cards.
 * - loadProjectMetadata (L20) - Fetches status rows and git summaries per project.
 */

import { ProjectGitSummary, ProjectRecord, ProjectStatus } from "../types";

export type ProjectMetadataPayload = {
  statusMap: Record<string, ProjectStatus[]>;
  gitSummaryMap: Record<string, ProjectGitSummary | null>;
};

export const loadProjectMetadata = async (
  projects: ProjectRecord[],
  apiGet: <T>(path: string) => Promise<T>
): Promise<ProjectMetadataPayload> => {
  /* Fetch container status for runnable projects in parallel (best-effort). */
  const statusEntries = await Promise.all(
    projects
      .filter((project) => project.runnable)
      .map(async (project) => {
        try {
          const rows = await apiGet<ProjectStatus[]>(`/api/projects/${project.id}/status`);
          return [project.id, rows] as const;
        } catch {
          return [project.id, []] as const;
        }
      })
  );

  /* Fetch git deltas for every project; clean/non-git repositories return null. */
  const gitEntries = await Promise.all(
    projects.map(async (project) => {
      try {
        const summary = await apiGet<ProjectGitSummary | null>(`/api/projects/${project.id}/git-summary`);
        return [project.id, summary] as const;
      } catch {
        return [project.id, null] as const;
      }
    })
  );

  return {
    statusMap: Object.fromEntries(statusEntries),
    gitSummaryMap: Object.fromEntries(gitEntries)
  };
};
