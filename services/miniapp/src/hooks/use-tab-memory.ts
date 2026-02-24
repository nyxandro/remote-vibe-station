/**
 * @fileoverview Local storage helpers for Mini App tab persistence.
 *
 * Exports:
 * - TabPersistenceState (L13) - Current and last workspace tab keys.
 * - readTabPersistenceState (L24) - Restores tab state from localStorage.
 * - persistTabSelection (L56) - Saves active tab and workspace tab memory.
 */

import { TabKey } from "../components/WorkspaceHeader";

export type TabPersistenceState = {
  activeTab: TabKey;
  lastWorkspaceTab: Exclude<TabKey, "projects">;
};

const STORAGE_KEY_ACTIVE_TAB = "tvoc.miniapp.activeTab";
const STORAGE_KEY_LAST_WORKSPACE_TAB = "tvoc.miniapp.lastWorkspaceTab";

const WORKSPACE_FALLBACK_TAB: Exclude<TabKey, "projects"> = "files";

const isTabKey = (value: string | null): value is TabKey => {
  return (
    value === "projects" ||
    value === "files" ||
    value === "providers" ||
    value === "github" ||
    value === "terminal" ||
    value === "containers" ||
    value === "settings"
  );
};

const isWorkspaceTab = (value: string | null): value is Exclude<TabKey, "projects"> => {
  return (
    value === "files" ||
    value === "providers" ||
    value === "github" ||
    value === "terminal" ||
    value === "containers" ||
    value === "settings"
  );
};

export const readTabPersistenceState = (): TabPersistenceState => {
  /* Restore current active tab, fallback to Projects for cold start. */
  const rawActive = localStorage.getItem(STORAGE_KEY_ACTIVE_TAB);
  const activeTab: TabKey = isTabKey(rawActive) ? rawActive : "projects";

  /* Keep separate memory for last non-project workspace tab. */
  const rawWorkspace = localStorage.getItem(STORAGE_KEY_LAST_WORKSPACE_TAB);
  const lastWorkspaceTab = isWorkspaceTab(rawWorkspace) ? rawWorkspace : WORKSPACE_FALLBACK_TAB;

  return { activeTab, lastWorkspaceTab };
};

export const persistTabSelection = (tab: TabKey): void => {
  /* Always persist the currently visible tab for direct restore. */
  localStorage.setItem(STORAGE_KEY_ACTIVE_TAB, tab);

  /* Persist only workspace tabs to avoid forcing Projects on reopen. */
  if (tab !== "projects") {
    localStorage.setItem(STORAGE_KEY_LAST_WORKSPACE_TAB, tab);
  }
};
