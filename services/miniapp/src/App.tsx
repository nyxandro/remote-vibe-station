/**
 * @fileoverview Main Mini App view.
 *
 * Exports:
 * - App (L42) - Root React component.
 */

import { useEffect, useMemo, useState } from "react";

import { TabKey, WorkspaceHeader } from "./components/WorkspaceHeader";
import { WorkspaceTabsContent } from "./components/WorkspaceTabsContent";

import { apiGet, apiPost } from "./api/client";
import {
  ContainerAction,
  FileListResponse,
  FileReadResponse,
  ProjectGitSummary,
  ProjectRecord,
  ProjectStatus
} from "./types";
import { useAuthControl } from "./hooks/use-auth-control";
import { useContainerStatusPolling } from "./hooks/use-container-status-polling";
import { useOpenCodeSettings } from "./hooks/use-opencode-settings";
import { useOpenCodeVersion } from "./hooks/use-opencode-version";
import { useProviderAuth } from "./hooks/use-provider-auth";
import { useProjectGit } from "./hooks/use-project-git";
import { persistTabSelection, readTabPersistenceState } from "./hooks/use-tab-memory";
import { useProjectWorkspace } from "./hooks/use-project-workspace";
import { useTerminalEvents } from "./hooks/use-terminal-events";
import { useVoiceControlSettings } from "./hooks/use-voice-control-settings";
import { iconForFileEntry } from "./utils/file-icons";
import { loadProjectMetadata } from "./utils/project-metadata";
import { highlightToHtml } from "./utils/syntax";
import { applyThemeToDocument, readStoredThemeMode, ThemeMode } from "./utils/theme";

type ProjectStatusMap = Record<string, ProjectStatus[]>;
type ProjectLogsMap = Record<string, string>;
type ProjectGitSummaryMap = Record<string, ProjectGitSummary | null>;

const STORAGE_KEY_ACTIVE_PROJECT = "tvoc.miniapp.activeProject";

export const App = () => {
  const restoredTabState = readTabPersistenceState();
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [statusMap, setStatusMap] = useState<ProjectStatusMap>({});
  const [logsMap, setLogsMap] = useState<ProjectLogsMap>({});
  const [gitSummaryMap, setGitSummaryMap] = useState<ProjectGitSummaryMap>({});
  const [activeId, setActiveId] = useState<string | null>(() => {
    return localStorage.getItem(STORAGE_KEY_ACTIVE_PROJECT);
  });
  const [activeTab, setActiveTab] = useState<TabKey>(() => restoredTabState.activeTab);
  const [query, setQuery] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string>("");
  const [fileList, setFileList] = useState<FileListResponse | null>(null);
  const [filePreview, setFilePreview] = useState<FileReadResponse | null>(null);
  const [filePreviewHtml, setFilePreviewHtml] = useState<string>("");
  const [terminalInput, setTerminalInput] = useState<string>("");
  const { canControlTelegramStream } = useAuthControl();
  const { terminalBuffer, clearTerminalBuffer } = useTerminalEvents(activeId);
  const { gitOverviewMap, loadGitOverview, runGitOperation, checkoutBranch, mergeBranch, commitAll } =
    useProjectGit(setError);
  const {
    overview: settingsOverview,
    activeFile: settingsActiveFile,
    setActiveFile: setSettingsActiveFile,
    loadOverview: loadSettingsOverview,
    openFile: openSettingsFile,
    saveActiveFile: saveSettingsFile,
    createFile: createSettingsFile
  } = useOpenCodeSettings(setError);
  const {
    overview: providerOverview,
    isLoading: isProviderLoading,
    isSubmitting: isProviderSubmitting,
    oauthState: providerOAuthState,
    setOAuthState: setProviderOAuthState,
    loadOverview: loadProviderOverview,
    startConnect: startProviderConnect,
    submitApiKey: submitProviderApiKey,
    completeOAuthAuto: completeProviderOAuthAuto,
    submitOAuthCode: submitProviderOAuthCode,
    disconnect: disconnectProvider
  } = useProviderAuth(setError);
  const clearActiveSelection = (): void => {
    setActiveId(null);
    setActiveTab("projects");
    setFileList(null);
    setFilePath("");
    setFilePreview(null);
    setFilePreviewHtml("");
    setSettingsActiveFile(null);
  };
  const [telegramStreamEnabled, setTelegramStreamEnabled] = useState<boolean>(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readStoredThemeMode());
  const [restartOpenCodeState, setRestartOpenCodeState] = useState<{
    isRestarting: boolean;
    lastResult: "idle" | "success" | "error";
  }>({ isRestarting: false, lastResult: "idle" });
  const {
    state: voiceControlState,
    setApiKey: setVoiceControlApiKey,
    setModel: setVoiceControlModel,
    loadSettings: loadVoiceControlSettings,
    saveSettings: saveVoiceControlSettings
  } = useVoiceControlSettings(setError);
  const {
    status: openCodeVersionStatus,
    isLoading: isOpenCodeVersionLoading,
    isUpdating: isOpenCodeVersionUpdating,
    loadStatus: loadOpenCodeVersionStatus,
    checkStatus: checkOpenCodeVersionStatus,
    updateNow: updateOpenCodeVersionNow
  } = useOpenCodeVersion(setError);

  const loadProjects = async (): Promise<void> => {
    try {
      setError(null);
      const data = await apiGet<ProjectRecord[]>("/api/projects");
      setProjects(data);

      void (async () => {
        const metadata = await loadProjectMetadata(data, apiGet);
        setStatusMap((prev) => ({ ...prev, ...metadata.statusMap }));
        setGitSummaryMap((prev) => ({ ...prev, ...metadata.gitSummaryMap }));
      })();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    }
  };

  const { createProjectFolder, cloneProjectRepository, deleteProjectFolder } = useProjectWorkspace(
    setError,
    loadProjects,
    clearActiveSelection
  );

  const restoreActiveProject = async (): Promise<void> => {
    /* Reopen project context on the last workspace tab instead of forcing Files. */
    const preferredWorkspaceTab = readTabPersistenceState().lastWorkspaceTab;

    try {
      const serverActive = await apiGet<ProjectRecord | null>("/api/projects/active");
      const slug = serverActive?.id ?? null;
      if (slug) {
        setActiveId(slug);
        localStorage.setItem(STORAGE_KEY_ACTIVE_PROJECT, slug);
        setActiveTab(preferredWorkspaceTab);
        if (preferredWorkspaceTab === "files") {
          void loadFiles(slug, "");
        }
        return;
      }
    } catch {
      // If backend is unavailable, local fallback still works.
    }

    if (activeId) {
      setActiveTab(preferredWorkspaceTab);
      if (preferredWorkspaceTab === "files") {
        void loadFiles(activeId, "");
      }
    }
  };

  const syncOpenCodeAtStartup = async (): Promise<void> => {
    try {
      await apiPost("/api/opencode/sync-projects", {});
    } catch {
      // Ignore startup sync errors.
    }
  };

  const syncOpenCodeNow = async (): Promise<void> => {
    try {
      setError(null);
      await apiPost("/api/opencode/sync-projects", {});
      await loadProjects();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to sync OpenCode projects");
    }
  };

  const restartOpenCodeNow = async (): Promise<void> => {
    /* Restart OpenCode runtime so freshly edited rules/config are picked up. */
    setRestartOpenCodeState({ isRestarting: true, lastResult: "idle" });
    try {
      setError(null);
      await apiPost("/api/opencode/restart", {});
      await loadSettingsOverview(activeId);
      setRestartOpenCodeState({ isRestarting: false, lastResult: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to restart OpenCode");
      setRestartOpenCodeState({ isRestarting: false, lastResult: "error" });
    }
  };

  const reloadSettingsNow = async (): Promise<void> => {
    /* Settings Reload also refreshes OpenCode latest-version availability. */
    await Promise.all([loadSettingsOverview(activeId), checkOpenCodeVersionStatus()]);
  };

  const startTelegramChat = async (): Promise<void> => {
    try {
      setError(null);
      await apiPost("/api/telegram/stream/start", {});
      setTelegramStreamEnabled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start Telegram stream");
    }
  };

  const endTelegramChat = async (): Promise<void> => {
    try {
      setError(null);
      await apiPost("/api/telegram/stream/stop", {});
      setTelegramStreamEnabled(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to stop Telegram stream");
    }
  };

  const loadStatus = async (projectId: string): Promise<void> => {
    try {
      setError(null);
      const data = await apiGet<ProjectStatus[]>(`/api/projects/${projectId}/status`);
      setStatusMap((prev) => ({ ...prev, [projectId]: data }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load status");
    }
  };

  const loadLogs = async (projectId: string): Promise<void> => {
    try {
      setError(null);
      const data = await apiGet<string>(`/api/projects/${projectId}/logs`);
      setLogsMap((prev) => ({ ...prev, [projectId]: data }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load logs");
    }
  };

  const runContainerAction = async (
    projectId: string,
    service: string,
    action: ContainerAction
  ): Promise<void> => {
    try {
      setError(null);
      await apiPost(
        `/api/projects/${projectId}/containers/${encodeURIComponent(service)}/${action}`,
        {}
      );
      await loadStatus(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to run container action: ${action}`);
    }
  };

  const loadFiles = async (projectId: string, nextPath: string): Promise<void> => {
    try {
      setError(null);
      const query = nextPath ? `?path=${encodeURIComponent(nextPath)}` : "";
      const data = await apiGet<FileListResponse>(`/api/projects/${projectId}/files${query}`);
      setFileList(data);
      setFilePath(nextPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load files");
    }
  };

  const openFile = async (projectId: string, relativePath: string): Promise<void> => {
    try {
      setError(null);
      const query = `?path=${encodeURIComponent(relativePath)}`;
      const data = await apiGet<FileReadResponse>(`/api/projects/${projectId}/file${query}`);
      setFilePreview(data);
      const html = await highlightToHtml(data.content, data.path);
      setFilePreviewHtml(html);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read file");
    }
  };

  const sendTerminal = async (projectId: string): Promise<void> => {
    const input = terminalInput;
    if (!input.trim()) {
      return;
    }

    try {
      setError(null);
      setTerminalInput("");
      await apiPost(`/api/projects/${projectId}/terminal/input`, { input: input + "\n" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send terminal input");
    }
  };

  const runAction = async (projectId: string, action: string): Promise<void> => {
    try {
      setError(null);
      await apiPost(`/api/projects/${projectId}/${action}`, {});
      await loadProjects();
      await loadStatus(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to run action: ${action}`);
    }
  };

  const selectProject = async (projectId: string): Promise<void> => {
    /* After project selection, keep the current tab unless user is in Projects list. */
    const preferredWorkspaceTab = readTabPersistenceState().lastWorkspaceTab;
    const nextTab: TabKey = activeTab === "projects" ? preferredWorkspaceTab : activeTab;

    try {
      setError(null);
      await apiPost(`/api/projects/${projectId}/select`, {});
      setActiveId(projectId);
      setActiveTab(nextTab);
      const selected = projects.find((p) => p.id === projectId) ?? null;
      if (selected?.runnable) {
        void loadStatus(projectId);
      }
      void loadGitOverview(projectId);

      if (nextTab === "files") {
        void loadFiles(projectId, "");
      }

      setFilePreview(null);
      setFilePreviewHtml("");
      setSettingsActiveFile(null);
      setLogsMap((prev) => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      clearTerminalBuffer();

      localStorage.setItem(STORAGE_KEY_ACTIVE_PROJECT, projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to select project");
    }
  };

  useEffect(() => {
    void (async () => {
      await syncOpenCodeAtStartup();
      await loadProjects();
      await restoreActiveProject();
    })();
  }, []);

  useEffect(() => {
    if (!canControlTelegramStream) {
      setTelegramStreamEnabled(false);
    }
  }, [canControlTelegramStream]);

  useEffect(() => {
    if (!canControlTelegramStream) {
      return;
    }

    void (async () => {
      try {
        const record = await apiGet<{ streamEnabled?: boolean } | null>(
          "/api/telegram/stream/status"
        );
        setTelegramStreamEnabled(Boolean(record?.streamEnabled));
      } catch {
        // Keep best-effort state.
      }
    })();
  }, [canControlTelegramStream]);

  const visibleProjects = useMemo(() => {
    return projects
      .filter((p) => {
        const q = query.trim().toLowerCase();
        if (!q) {
          return true;
        }
        return p.slug.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
      });
  }, [projects, query]);

  const activeProject = useMemo(() => {
    if (!activeId) {
      return null;
    }
    return projects.find((p) => p.id === activeId) ?? null;
  }, [activeId, projects]);

  const canUseProjectTabs = Boolean(activeProject);

  useContainerStatusPolling({
    projectId: activeProject?.id ?? null,
    isRunnable: Boolean(activeProject?.runnable),
    onPoll: (projectId) => {
      void loadStatus(projectId);
    }
  });

  useEffect(() => {
    persistTabSelection(activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (activeId) {
      localStorage.setItem(STORAGE_KEY_ACTIVE_PROJECT, activeId);
      return;
    }
    localStorage.removeItem(STORAGE_KEY_ACTIVE_PROJECT);
  }, [activeId]);

  useEffect(() => {
    applyThemeToDocument(themeMode);
  }, [themeMode]);

  useEffect(() => {
    if (activeTab === "github" && activeId) {
      void loadGitOverview(activeId);
    }
  }, [activeId, activeTab, loadGitOverview]);

  useEffect(() => {
    if (activeTab === "settings") {
      void loadSettingsOverview(activeId);
      void loadOpenCodeVersionStatus();
      if (canControlTelegramStream) {
        void loadVoiceControlSettings();
      }
    }
  }, [
    activeId,
    activeTab,
    canControlTelegramStream,
    loadOpenCodeVersionStatus,
    loadSettingsOverview,
    loadVoiceControlSettings
  ]);

  useEffect(() => {
    /* Load providers overview only when user opens dedicated Providers tab. */
    if (activeTab !== "providers") {
      return;
    }
    void loadProviderOverview();
  }, [activeTab, loadProviderOverview]);

  const withActiveProject = (run: (projectId: string) => void): void => {
    if (activeId) {
      run(activeId);
    }
  };

  return (
    <div className="app-shell">
      <section className="panel">
        <WorkspaceHeader
          activeProject={activeProject}
          activeTab={activeTab}
          canUseProjectTabs={canUseProjectTabs}
          canControlTelegramStream={canControlTelegramStream}
          telegramStreamEnabled={telegramStreamEnabled}
          onSetTab={setActiveTab}
          onStartStream={() => void startTelegramChat()}
          onStopStream={() => void endTelegramChat()}
        />

        {error ? <div className="alert">{error}</div> : null}

        <WorkspaceTabsContent
          activeTab={activeTab}
          activeId={activeId}
          visibleProjects={visibleProjects}
          query={query}
          telegramStreamEnabled={telegramStreamEnabled}
          statusMap={statusMap}
          gitSummaryMap={gitSummaryMap}
          logsMap={logsMap}
          filePath={filePath}
          fileList={fileList}
          filePreview={filePreview}
          filePreviewHtml={filePreviewHtml}
          terminalBuffer={terminalBuffer}
          terminalInput={terminalInput}
          themeMode={themeMode}
          gitOverview={activeId ? gitOverviewMap[activeId] : undefined}
          providerOverview={providerOverview}
          settingsOverview={settingsOverview}
          settingsActiveFile={settingsActiveFile}
          onQueryChange={setQuery}
          onSelectProject={(id) => void selectProject(id)}
          onCreateProjectFolder={(name) => void createProjectFolder(name)}
          onCloneRepository={(repositoryUrl, folderName) =>
            void cloneProjectRepository(repositoryUrl, folderName)
          }
          onRunComposeAction={(action) => withActiveProject((id) => void runAction(id, action))}
          onRunContainerAction={(service, action) =>
            withActiveProject((id) => void runContainerAction(id, service, action))
          }
          onLoadLogs={() => withActiveProject((id) => void loadLogs(id))}
          onFilesUp={() => {
            if (!activeId) {
              return;
            }
            const parts = filePath.split("/").filter(Boolean);
            parts.pop();
            void loadFiles(activeId, parts.join("/"));
          }}
          onFilesRefresh={() => withActiveProject((id) => void loadFiles(id, filePath))}
          onOpenEntry={(nextPath, kind) => {
            if (!activeId) {
              return;
            }
            if (kind === "dir") {
              void loadFiles(activeId, nextPath);
              return;
            }
            void openFile(activeId, nextPath);
          }}
          onInputChange={setTerminalInput}
          onSendTerminal={() => withActiveProject((id) => void sendTerminal(id))}
          onChangeTheme={setThemeMode}
          onRefreshProjects={() => void loadProjects()}
          onSyncProjects={() => void syncOpenCodeNow()}
          onRestartOpenCode={() => void restartOpenCodeNow()}
          onLoadSettingsOverview={() => void reloadSettingsNow()}
          onOpenSettingsFile={(kind, relativePath) =>
            void openSettingsFile(kind, activeId, relativePath)
          }
          onCreateSettingsFile={(kind, name) => void createSettingsFile(kind, activeId, name)}
          onSaveSettingsFile={(content) => saveSettingsFile(activeId, content)}
          onDeleteActiveProject={() => {
            if (!activeId) {
              return;
            }
            if (window.confirm(`Delete local project folder '${activeId}'?`)) {
              void deleteProjectFolder(activeId);
            }
          }}
          restartOpenCodeState={restartOpenCodeState}
          voiceControl={canControlTelegramStream ? voiceControlState : undefined}
          onVoiceControlApiKeyChange={setVoiceControlApiKey}
          onVoiceControlModelChange={setVoiceControlModel}
          onReloadVoiceControl={() => void loadVoiceControlSettings()}
          onSaveVoiceControl={() => void saveVoiceControlSettings()}
          openCodeVersion={{
            status: openCodeVersionStatus,
            isLoading: isOpenCodeVersionLoading,
            isUpdating: isOpenCodeVersionUpdating
          }}
          onUpdateOpenCodeVersion={() => void updateOpenCodeVersionNow()}
          iconForEntry={iconForFileEntry}
          onGitRefresh={() => withActiveProject((id) => void loadGitOverview(id))}
          onGitCheckout={(branch) => withActiveProject((id) => void checkoutBranch(id, branch))}
          onGitCommit={(message) => withActiveProject((id) => void commitAll(id, message))}
          onGitFetch={() => withActiveProject((id) => void runGitOperation(id, "fetch"))}
          onGitPull={() => withActiveProject((id) => void runGitOperation(id, "pull"))}
          onGitPush={() => withActiveProject((id) => void runGitOperation(id, "push"))}
          onGitMerge={(sourceBranch) => withActiveProject((id) => void mergeBranch(id, sourceBranch))}
          providersState={{
            isLoading: isProviderLoading,
            isSubmitting: isProviderSubmitting,
            oauthState: providerOAuthState,
            onRefresh: () => void loadProviderOverview(),
            onStartConnect: (input) => void startProviderConnect(input),
            onSubmitApiKey: (input) => void submitProviderApiKey(input),
            onSubmitOAuthCode: () => void submitProviderOAuthCode(),
            onCompleteOAuthAuto: () => void completeProviderOAuthAuto(),
            onDisconnect: (providerID) => void disconnectProvider(providerID),
            onChangeOAuthCodeDraft: (value) =>
              setProviderOAuthState((prev) => (prev ? { ...prev, codeDraft: value } : prev))
          }}
        />
      </section>
    </div>
  );
};
