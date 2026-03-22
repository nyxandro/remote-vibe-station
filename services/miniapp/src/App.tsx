/**
 * @fileoverview Main Mini App view.
 *
 * Exports:
 * - App (L42) - Root React component.
 */

import { useEffect, useMemo, useState } from "react";

import { TabKey, WorkspaceHeader } from "./components/WorkspaceHeader";
import { WorkspaceTabsContent } from "./components/WorkspaceTabsContent";

import { useAuthControl } from "./hooks/use-auth-control";
import { useContainerStatusPolling } from "./hooks/use-container-status-polling";
import { useGithubAuth } from "./hooks/use-github-auth";
import { useOpenCodeAdminActions } from "./hooks/use-open-code-admin-actions";
import { useOpenCodeSettings } from "./hooks/use-opencode-settings";
import { useOpenCodeVersion } from "./hooks/use-opencode-version";
import { useProjectCatalogState } from "./hooks/use-project-catalog-state";
import { useProjectFiles } from "./hooks/use-project-files";
import { useProviderAuth } from "./hooks/use-provider-auth";
import { useProjectGit } from "./hooks/use-project-git";
import { persistTabSelection, readTabPersistenceState } from "./hooks/use-tab-memory";
import { useTelegramStreamControl } from "./hooks/use-telegram-stream-control";
import { useThemeMode } from "./hooks/use-theme-mode";
import { useProjectWorkspace } from "./hooks/use-project-workspace";
import { useWorkspaceRuntimeActions } from "./hooks/use-workspace-runtime-actions";
import { useProjectRuntime } from "./hooks/use-project-runtime";
import { useWorkspaceSelection } from "./hooks/use-workspace-selection";
import { useCliproxyAccounts } from "./hooks/use-cliproxy-accounts";
import { useProxySettings } from "./hooks/use-proxy-settings";
import { useServerMetrics } from "./hooks/use-server-metrics";
import { useTerminalEvents } from "./hooks/use-terminal-events";
import { useVoiceControlSettings } from "./hooks/use-voice-control-settings";
import { iconForFileEntry } from "./utils/file-icons";

const isProjectScopedTab = (tab: TabKey): boolean => {
  /* Providers/settings stay useful without an active project, but kanban remains project-specific. */
  return tab === "files" || tab === "github" || tab === "tasks" || tab === "containers" || tab === "terminal";
};

export const App = () => {
  const restoredTabState = readTabPersistenceState();
  const [activeTab, setActiveTab] = useState<TabKey>(() => restoredTabState.activeTab);
  const [query, setQuery] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [terminalInput, setTerminalInput] = useState<string>("");
  const { canControlTelegramStream } = useAuthControl();
  const { gitOverviewMap, loadGitOverview, runGitOperation, checkoutBranch, mergeBranch, commitAll } =
    useProjectGit(setError);
  const {
    projects,
    statusMap,
    logsMap,
    gitSummaryMap,
    loadProjects,
    loadStatus,
    loadLogs,
    clearLogs
  } = useProjectCatalogState(setError);
  const {
    filePath,
    fileList,
    filePreview,
    loadFiles,
    openFile,
    closeFilePreview,
    resetFiles,
    downloadFile,
    uploadFileFromDevice,
    importFileFromUrl
  } = useProjectFiles(setError);
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
  const {
    activeId,
    setActiveId,
    activeProject,
    restoreActiveProject,
    selectProject
  } = useWorkspaceSelection({
    projects,
    activeTab,
    setActiveTab,
    loadFiles,
    loadStatus,
    loadGitOverview,
    closeFilePreview,
    setSettingsActiveFile,
    clearTerminalBuffer: () => clearTerminalBuffer(),
    clearLogs,
    setError
  });
  const { terminalBuffer, clearTerminalBuffer } = useTerminalEvents(activeId);
  const clearActiveSelection = (): void => {
    setActiveId(null);
    setActiveTab("projects");
    resetFiles();
    setSettingsActiveFile(null);
  };
  const { telegramStreamEnabled, startTelegramChat, endTelegramChat } = useTelegramStreamControl(
    setError,
    canControlTelegramStream
  );
  const { themeMode, setThemeMode } = useThemeMode();
  const {
    state: voiceControlState,
    setApiKey: setVoiceControlApiKey,
    setModel: setVoiceControlModel,
    loadSettings: loadVoiceControlSettings,
    saveSettings: saveVoiceControlSettings
  } = useVoiceControlSettings(setError);
  const {
    state: githubAuthState,
    loadStatus: loadGithubAuthStatus,
    setTokenDraft: setGithubTokenDraft,
    saveToken: saveGithubToken,
    disconnect: disconnectGithubAuth
  } = useGithubAuth(setError);
  const {
    status: openCodeVersionStatus,
    isLoading: isOpenCodeVersionLoading,
    isUpdating: isOpenCodeVersionUpdating,
    loadStatus: loadOpenCodeVersionStatus,
    checkStatus: checkOpenCodeVersionStatus,
    updateNow: updateOpenCodeVersionNow
  } = useOpenCodeVersion(setError);
  const {
    metrics: serverMetrics,
    isLoading: isServerMetricsLoading,
    loadMetrics: loadServerMetrics
  } = useServerMetrics(setError);
  const {
    snapshot: proxySettings,
    isLoading: isProxySettingsLoading,
    isSaving: isProxySettingsSaving,
    isApplying: isProxySettingsApplying,
    applyResult: proxyApplyResult,
    loadSettings: loadProxySettings,
    saveSettings: saveProxySettings,
    applySettings: applyProxySettings
  } = useProxySettings(setError);
  const {
    state: cliproxyAccounts,
    isLoading: isCliproxyAccountsLoading,
    isSubmitting: isCliproxyAccountsSubmitting,
    oauthStart: cliproxyOAuthStart,
    loadState: loadCliproxyAccounts,
    startOAuth: startCliproxyOAuth,
    completeOAuth: completeCliproxyOAuth,
    testAccount: testCliproxyAccount,
    activateAccount: activateCliproxyAccount,
    deleteAccount: deleteCliproxyAccount
  } = useCliproxyAccounts(setError);

  const { createProjectFolder, cloneProjectRepository, deleteProjectFolder } = useProjectWorkspace(
    setError,
    loadProjects,
    clearActiveSelection
  );
  const {
    runtime,
    isRuntimeLoading,
    isRuntimeSaving,
    loadRuntime,
    saveSettings,
    deployStart,
    deployStop
  } = useProjectRuntime(setError, loadProjects);
  const {
    restartOpenCodeState,
    syncOpenCodeAtStartup,
    syncOpenCodeNow,
    restartOpenCodeNow,
    reloadSettingsNow
  } = useOpenCodeAdminActions({
    setError,
    activeId,
    loadProjects,
    loadSettingsOverview,
    checkOpenCodeVersionStatus
  });
  const { runContainerAction, sendTerminal, runAction } = useWorkspaceRuntimeActions({
    setError,
    terminalInput,
    setTerminalInput,
    loadProjects,
    loadStatus
  });

  useEffect(() => {
    void (async () => {
      await syncOpenCodeAtStartup();
      await loadProjects();
      await restoreActiveProject();
    })();
  }, []);

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
    /* Clear stale restored workspace tabs when startup no longer has an active project selected. */
    if (!canUseProjectTabs && isProjectScopedTab(activeTab)) {
      setActiveTab("projects");
    }
  }, [activeTab, canUseProjectTabs]);

  useEffect(() => {
    if (activeTab === "github" && activeId) {
      void loadGitOverview(activeId);
    }
  }, [activeId, activeTab, loadGitOverview]);

  useEffect(() => {
    /* Entering Files must always refresh the current folder so tree state never depends on stale cache. */
    if (activeTab !== "files" || !activeId) {
      return;
    }
    void loadFiles(activeId, filePath);
  }, [activeId, activeTab]);

  useEffect(() => {
    if (activeTab === "settings") {
      void loadSettingsOverview(activeId);
      void loadOpenCodeVersionStatus();
      if (activeId) {
        void loadRuntime(activeId);
      } else {
        void loadRuntime(null);
      }
      if (canControlTelegramStream) {
        void loadVoiceControlSettings();
      }
      void loadGithubAuthStatus();
    }
  }, [
    activeId,
    activeTab,
    canControlTelegramStream,
    loadOpenCodeVersionStatus,
    loadRuntime,
    loadSettingsOverview,
    loadGithubAuthStatus,
    loadVoiceControlSettings
  ]);

  useEffect(() => {
    /* Providers tab now aggregates direct provider auth plus CLIProxy account/runtime management. */
    if (activeTab !== "providers") {
      return;
    }
    void loadProviderOverview();
    void loadProxySettings();
    void loadCliproxyAccounts();
  }, [activeTab, loadCliproxyAccounts, loadProviderOverview, loadProxySettings]);

  useEffect(() => {
    /* Refresh server diagnostics only when Settings screen is visible. */
    if (activeTab !== "settings") {
      return;
    }
    void loadServerMetrics();
  }, [activeTab, loadServerMetrics]);

  const withActiveProject = (run: (projectId: string) => void): void => {
    if (activeId) {
      run(activeId);
    }
  };

  const withActiveProjectAsync = async <T,>(run: (projectId: string) => Promise<T>): Promise<T | undefined> => {
    /* Upload/download helpers need the active project id and must preserve the async lifecycle for modal UX. */
    if (!activeId) {
      return undefined;
    }

    return run(activeId);
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
          activeProject={activeProject}
          visibleProjects={visibleProjects}
          query={query}
          telegramStreamEnabled={telegramStreamEnabled}
          statusMap={statusMap}
          gitSummaryMap={gitSummaryMap}
          logsMap={logsMap}
          filePath={filePath}
          fileList={fileList}
          filePreview={filePreview}
          terminalBuffer={terminalBuffer}
          terminalInput={terminalInput}
          themeMode={themeMode}
          gitOverview={activeId ? gitOverviewMap[activeId] : undefined}
          providerOverview={providerOverview}
          settingsOverview={settingsOverview}
          settingsActiveFile={settingsActiveFile}
          onQueryChange={setQuery}
          onSelectProject={(id) => void selectProject(id)}
          onDeployProject={(id) => void deployStart(id)}
          onStopProjectDeploy={(id) => void deployStop(id)}
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
          onCloseFilePreview={closeFilePreview}
          onDownloadFilePreview={(relativePath) => withActiveProjectAsync((id) => downloadFile(id, relativePath))}
          onUploadFileFromDevice={(currentPath, file) => withActiveProjectAsync((id) => uploadFileFromDevice(id, currentPath, file))}
          onImportFileFromUrl={(currentPath, url) => withActiveProjectAsync((id) => importFileFromUrl(id, currentPath, url))}
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
          projectRuntime={{
            snapshot: runtime,
            isLoading: isRuntimeLoading,
            isSaving: isRuntimeSaving
          }}
          onSaveProjectRuntimeSettings={(patch) => {
            if (!activeId) {
              return;
            }
            void saveSettings(activeId, patch);
          }}
          restartOpenCodeState={restartOpenCodeState}
          voiceControl={canControlTelegramStream ? voiceControlState : undefined}
          onVoiceControlApiKeyChange={setVoiceControlApiKey}
          onVoiceControlModelChange={setVoiceControlModel}
          onReloadVoiceControl={() => void loadVoiceControlSettings()}
          onSaveVoiceControl={() => void saveVoiceControlSettings()}
          githubAuth={githubAuthState}
          onReloadGithubAuth={() => void loadGithubAuthStatus()}
          onGithubTokenDraftChange={setGithubTokenDraft}
          onSaveGithubToken={() => void saveGithubToken()}
          onDisconnectGithubAuth={() => void disconnectGithubAuth()}
          openCodeVersion={{
            status: openCodeVersionStatus,
            isLoading: isOpenCodeVersionLoading,
            isUpdating: isOpenCodeVersionUpdating
          }}
          onUpdateOpenCodeVersion={() => void updateOpenCodeVersionNow()}
          serverMetrics={{
            snapshot: serverMetrics,
            isLoading: isServerMetricsLoading
          }}
          onReloadServerMetrics={() => void loadServerMetrics()}
          iconForEntry={(name, kind) => iconForFileEntry(name, kind)}
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
          proxyState={{
            snapshot: proxySettings,
            isLoading: isProxySettingsLoading,
            isSaving: isProxySettingsSaving,
            isApplying: isProxySettingsApplying,
            applyResult: proxyApplyResult,
            cliproxyAccounts,
            cliproxyOAuthStart,
            isCliproxyLoading: isCliproxyAccountsLoading,
            isCliproxySubmitting: isCliproxyAccountsSubmitting,
            onReload: () => void loadProxySettings(),
            onSave: (input) => void saveProxySettings(input),
            onApply: () => void applyProxySettings(),
            onReloadCliproxy: () => void loadCliproxyAccounts(),
            onStartCliproxyAuth: (provider) => void startCliproxyOAuth(provider),
            onCompleteCliproxyAuth: (input) => void completeCliproxyOAuth(input),
            onTestCliproxyAccount: (accountId) => void testCliproxyAccount(accountId),
            onActivateCliproxyAccount: (accountId) => void activateCliproxyAccount(accountId),
            onDeleteCliproxyAccount: (accountId) => void deleteCliproxyAccount(accountId)
          }}
        />
      </section>
    </div>
  );
};
