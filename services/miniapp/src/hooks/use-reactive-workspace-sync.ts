/**
 * @fileoverview Centralized reactive synchronization for Mini App tabs.
 *
 * Exports:
 * - ReactiveWorkspaceSyncInput - Loader contract for tab-aware reactive refresh.
 * - useReactiveWorkspaceSync - Keeps visible tabs fresh via entry loads, focus sync, and lightweight polling.
 */

import { useCallback, useEffect, useRef } from "react";

import { TabKey } from "../components/WorkspaceHeader";

export type ReactiveWorkspaceSyncInput = {
  activeTab: TabKey;
  activeId: string | null;
  filePath: string;
  loadProjects: () => Promise<void> | void;
  loadGitOverview: (projectId: string) => Promise<void> | void;
  loadFiles: (projectId: string, path: string) => Promise<void> | void;
  loadSettingsOverview: (projectId: string | null) => Promise<void> | void;
  loadOpenCodeVersionStatus: () => Promise<void> | void;
  loadVoiceControlSettings: () => Promise<void> | void;
  loadGithubAuthStatus: () => Promise<void> | void;
  loadServerMetrics: () => Promise<void> | void;
  loadRuntimeServices: () => Promise<void> | void;
  checkRuntimeVersion: () => Promise<void> | void;
  loadProviderOverview: () => Promise<void> | void;
  loadProxySettings: () => Promise<void> | void;
  loadCliproxyAccounts: () => Promise<void> | void;
};

const REACTIVE_POLL_INTERVAL_MS: Partial<Record<TabKey, number>> = {
  github: 12000,
  projects: 15000,
  providers: 20000,
  settings: 30000
};

const MIN_REFRESH_GAP_MS = 4000;

const isVisibleDocument = (): boolean => document.visibilityState === "visible";

export const useReactiveWorkspaceSync = (input: ReactiveWorkspaceSyncInput): void => {
  const inputRef = useRef<ReactiveWorkspaceSyncInput>(input);
  const isRefreshingRef = useRef<boolean>(false);
  const lastRefreshAtRef = useRef<number>(0);

  /* Keep async listeners/intervals pointed at the latest workspace state without recreating them on every render. */
  inputRef.current = input;

  const refreshActiveTab = useCallback(async (reason: "entry" | "poll" | "focus"): Promise<void> => {
    /* Central sync only covers tabs that currently rely on request/response loaders instead of live streams. */
    const current = inputRef.current;
    const shouldRateLimit = reason !== "entry";
    const nowMs = Date.now();
    const markRefreshStarted = (): void => {
      isRefreshingRef.current = true;
      lastRefreshAtRef.current = nowMs;
    };

    if (isRefreshingRef.current || (shouldRateLimit && nowMs - lastRefreshAtRef.current < MIN_REFRESH_GAP_MS)) {
      return;
    }

    try {
      if (current.activeTab === "projects") {
        markRefreshStarted();
        await current.loadProjects();
        return;
      }

      if (current.activeTab === "github") {
        if (!current.activeId) {
          return;
        }

        markRefreshStarted();
        await current.loadGitOverview(current.activeId);
        return;
      }

      if (current.activeTab === "files") {
        if (!current.activeId) {
          return;
        }

        markRefreshStarted();
        await current.loadFiles(current.activeId, current.filePath);
        return;
      }

      if (current.activeTab === "settings") {
        markRefreshStarted();

        /* Settings aggregates several independent backend slices, so refresh them together to avoid stale islands. */
        const settingsRequests: Array<Promise<void> | void> = [
          current.loadSettingsOverview(current.activeId),
          current.loadOpenCodeVersionStatus(),
          current.loadGithubAuthStatus(),
          current.loadServerMetrics(),
          current.loadRuntimeServices(),
          current.checkRuntimeVersion()
        ];

        settingsRequests.push(current.loadVoiceControlSettings());

        await Promise.all(settingsRequests);
        return;
      }

      if (current.activeTab === "providers") {
        markRefreshStarted();

        /* Provider auth, proxy runtime and CLIProxy accounts share one screen and should stay in sync together. */
        await Promise.all([
          current.loadProviderOverview(),
          current.loadProxySettings(),
          current.loadCliproxyAccounts()
        ]);
      }
    } catch (error) {
      /* Loader hooks usually handle their own errors, but unexpected throws must not escape fire-and-forget sync. */
      console.error("Reactive workspace sync failed", error);
    } finally {
      isRefreshingRef.current = false;
    }
  }, []);

  useEffect(() => {
    /* Entering a request-driven tab should immediately hydrate it from the current backend state. */
    void refreshActiveTab("entry");
  }, [input.activeId, input.activeTab, input.filePath, refreshActiveTab]);

  useEffect(() => {
    /* Poll only the currently visible tab and only where live server events do not exist yet. */
    const pollIntervalMs = REACTIVE_POLL_INTERVAL_MS[input.activeTab];
    if (!pollIntervalMs) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (!isVisibleDocument()) {
        return;
      }

      void refreshActiveTab("poll");
    }, pollIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [input.activeTab, refreshActiveTab]);

  useEffect(() => {
    /* Focus/visibility sync keeps stale tabs fresh after the user returns from another app or browser view. */
    const handleWindowFocus = () => {
      if (!isVisibleDocument()) {
        return;
      }

      void refreshActiveTab("focus");
    };

    const handleVisibilityChange = () => {
      if (!isVisibleDocument()) {
        return;
      }

      void refreshActiveTab("focus");
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshActiveTab]);
};
