/**
 * @fileoverview Workspace project catalog state and metadata loaders.
 *
 * Exports:
 * - ProjectStatusMap - Container status rows keyed by project id.
 * - ProjectLogsMap - Compose logs keyed by project id.
 * - ProjectGitSummaryMap - Git summary snapshot keyed by project id.
 * - useProjectCatalogState - Loads project catalog plus best-effort metadata for the workspace shell.
 */

import { useCallback, useRef, useState } from "react";

import { apiGet } from "../api/client";
import { ProjectGitSummary, ProjectRecord, ProjectStatus } from "../types";
import { loadProjectMetadata } from "../utils/project-metadata";

export type ProjectStatusMap = Record<string, ProjectStatus[]>;
export type ProjectLogsMap = Record<string, string>;
export type ProjectGitSummaryMap = Record<string, ProjectGitSummary | null>;

export const useProjectCatalogState = (setError: (value: string | null) => void) => {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [statusMap, setStatusMap] = useState<ProjectStatusMap>({});
  const [logsMap, setLogsMap] = useState<ProjectLogsMap>({});
  const [gitSummaryMap, setGitSummaryMap] = useState<ProjectGitSummaryMap>({});
  const projectsRequestIdRef = useRef(0);
  const metadataRequestIdRef = useRef(0);
  const statusRequestIdRef = useRef<Record<string, number>>({});

  const loadProjects = useCallback(async (): Promise<void> => {
    /* Keep catalog and metadata request ordering explicit so stale refreshes cannot overwrite newer state. */
    const requestId = ++projectsRequestIdRef.current;

    try {
      setError(null);
      const data = await apiGet<ProjectRecord[]>("/api/projects");
      if (requestId !== projectsRequestIdRef.current) {
        return;
      }

      setProjects(data);

      const metadataRequestId = ++metadataRequestIdRef.current;
      void (async () => {
        try {
          const metadata = await loadProjectMetadata(data, apiGet);
          if (metadataRequestId !== metadataRequestIdRef.current) {
            return;
          }

          setStatusMap(metadata.statusMap);
          setGitSummaryMap(metadata.gitSummaryMap);
        } catch {
          /* Metadata remains best-effort so the main catalog never disappears due to one slow side request. */
        }
      })();
    } catch (error) {
      if (requestId !== projectsRequestIdRef.current) {
        return;
      }

      setError(error instanceof Error ? error.message : "Failed to load projects");
    }
  }, [setError]);

  const loadStatus = useCallback(
    async (projectId: string): Promise<void> => {
      /* Compose status refresh stays project-local so polling and manual actions can update one card cheaply. */
      const requestId = (statusRequestIdRef.current[projectId] ?? 0) + 1;
      statusRequestIdRef.current[projectId] = requestId;

      try {
        setError(null);
        const data = await apiGet<ProjectStatus[]>(`/api/projects/${projectId}/status`);
        if (statusRequestIdRef.current[projectId] !== requestId) {
          return;
        }

        setStatusMap((prev) => ({ ...prev, [projectId]: data }));
      } catch (error) {
        if (statusRequestIdRef.current[projectId] !== requestId) {
          return;
        }

        setError(error instanceof Error ? error.message : "Failed to load status");
      }
    },
    [setError]
  );

  const loadLogs = useCallback(
    async (projectId: string): Promise<void> => {
      /* Logs stay on-demand because full compose output is heavier than card metadata. */
      try {
        setError(null);
        const data = await apiGet<string>(`/api/projects/${projectId}/logs`);
        setLogsMap((prev) => ({ ...prev, [projectId]: data }));
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to load logs");
      }
    },
    [setError]
  );

  const clearLogs = useCallback((projectId: string): void => {
    /* Project switches should drop stale log panes so another project cannot inherit the previous tail output. */
    setLogsMap((prev) => {
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
  }, []);

  return {
    projects,
    statusMap,
    logsMap,
    gitSummaryMap,
    loadProjects,
    loadStatus,
    loadLogs,
    clearLogs
  };
};
