/**
 * @fileoverview OpenCode skills catalog and install actions for Mini App.
 *
 * Exports:
 * - SkillMutationKind - Discriminator for which mutation (install/uninstall) is in flight.
 * - SkillMutationStatus - Last completed mutation outcome with kind and message for UI toasts.
 * - useOpenCodeSkills - Loads NeuralDeep catalog, installed skills, and install/remove actions
 *   with reactive mutation state suitable for progress indicators.
 */

import { useCallback, useState } from "react";

import { apiDelete, apiGet, apiPost } from "../api/client";
import { InstalledOpenCodeSkill, NeuralDeepSkillCatalogItem, SkillCatalogFilter } from "../types";

type SkillInstallInput = {
  id: string;
  name: string;
  owner: string | null;
  repo: string | null;
};

export type SkillMutationKind = "install" | "uninstall";

export type SkillMutationStatus = {
  kind: SkillMutationKind;
  outcome: "success" | "error";
  skillName: string;
  message: string;
};

export const useOpenCodeSkills = (setError: (value: string | null) => void) => {
  /* Catalog comes from NeuralDeep with installed flags merged on the backend. */
  const [catalog, setCatalog] = useState<NeuralDeepSkillCatalogItem[]>([]);
  const [installedSkills, setInstalledSkills] = useState<InstalledOpenCodeSkill[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [mutatingSkillName, setMutatingSkillName] = useState<string | null>(null);
  const [mutatingKind, setMutatingKind] = useState<SkillMutationKind | null>(null);
  const [mutationStartedAt, setMutationStartedAt] = useState<number | null>(null);
  const [mutationStatus, setMutationStatus] = useState<SkillMutationStatus | null>(null);

  const fetchInstalled = useCallback(async (): Promise<void> => {
    /* Installed list mirrors the OpenCode config volume directly. */
    const data = await apiGet<InstalledOpenCodeSkill[]>("/api/opencode/skills/installed");
    setInstalledSkills(data);
  }, []);

  const loadInstalled = useCallback(async (): Promise<void> => {
    /* Standalone refresh used when the tab opens without a catalog request. */
    try {
      setError(null);
      setIsLoading(true);
      await fetchInstalled();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load installed OpenCode skills");
    } finally {
      setIsLoading(false);
    }
  }, [fetchInstalled, setError]);

  const search = useCallback(
    async (query: string, installed: SkillCatalogFilter): Promise<void> => {
      /* Search runs through backend so install markers stay consistent with the shared volume. */
      try {
        setError(null);
        setIsLoading(true);
        const params = new URLSearchParams();
        if (query.trim().length > 0) {
          params.set("q", query.trim());
        }
        params.set("installed", installed);

        const [catalogData] = await Promise.all([
          apiGet<NeuralDeepSkillCatalogItem[]>(`/api/opencode/skills?${params.toString()}`),
          fetchInstalled()
        ]);
        setCatalog(catalogData);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to load OpenCode skills");
      } finally {
        setIsLoading(false);
      }
    },
    [fetchInstalled, setError]
  );

  const dismissMutationStatus = useCallback((): void => {
    /* Toast banners are dismissible so users can clear stale success/error messages. */
    setMutationStatus(null);
  }, []);

  const beginMutation = (name: string, kind: SkillMutationKind): void => {
    /* Single source of truth for "what is happening right now" used by progress indicators. */
    setMutatingSkillName(name);
    setMutatingKind(kind);
    setMutationStartedAt(Date.now());
    setMutationStatus(null);
  };

  const endMutation = (): void => {
    setMutatingSkillName(null);
    setMutatingKind(null);
    setMutationStartedAt(null);
  };

  const install = useCallback(
    async (input: SkillInstallInput, query: string, filter: SkillCatalogFilter): Promise<void> => {
      /* Installation writes SKILL.md, then refreshes both catalog badges and installed list. */
      beginMutation(input.name, "install");
      try {
        setError(null);
        await apiPost("/api/opencode/skills/install", input);
        await search(query, filter);
        setMutationStatus({
          kind: "install",
          outcome: "success",
          skillName: input.name,
          message: `Скилл «${input.name}» установлен.`
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to install OpenCode skill";
        setError(message);
        setMutationStatus({ kind: "install", outcome: "error", skillName: input.name, message });
      } finally {
        endMutation();
      }
    },
    [search, setError]
  );

  const uninstall = useCallback(
    async (name: string, query: string, filter: SkillCatalogFilter): Promise<void> => {
      /* Removal is local only and constrained by backend path validation. */
      beginMutation(name, "uninstall");
      try {
        setError(null);
        await apiDelete("/api/opencode/skills/uninstall", { name });
        await search(query, filter);
        setMutationStatus({
          kind: "uninstall",
          outcome: "success",
          skillName: name,
          message: `Скилл «${name}» удалён.`
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to remove OpenCode skill";
        setError(message);
        setMutationStatus({ kind: "uninstall", outcome: "error", skillName: name, message });
      } finally {
        endMutation();
      }
    },
    [search, setError]
  );

  return {
    catalog,
    installedSkills,
    isLoading,
    mutatingSkillName,
    mutatingKind,
    mutationStartedAt,
    mutationStatus,
    loadInstalled,
    search,
    install,
    uninstall,
    dismissMutationStatus
  };
};
