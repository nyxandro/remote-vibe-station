/**
 * @fileoverview Small hook for loading the project catalog outside the main App shell.
 *
 * Exports:
 * - useProjectCatalog - Fetches all projects for standalone kanban filters and create dialogs.
 */

import { useCallback, useState } from "react";

import { apiGet } from "../api/client";
import { ProjectRecord } from "../types";

export const useProjectCatalog = () => {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async (): Promise<void> => {
    /* Standalone board loads the same project list used by the workspace shell. */
    setIsLoading(true);
    setError(null);

    try {
      const nextProjects = await apiGet<ProjectRecord[]>("/api/projects");
      setProjects(nextProjects);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to load projects");
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    projects,
    isLoading,
    error,
    loadProjects
  };
};
