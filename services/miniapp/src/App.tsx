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
import { useThemeMode } from "./hooks/use-theme-mode";
import { useProjectWorkspace } from "./hooks/use-project-workspace";
import { useWorkspaceRuntimeActions } from "./hooks/use-workspace-runtime-actions";
import { useReactiveWorkspaceSync } from "./hooks/use-reactive-workspace-sync";
import { useWorkspaceEvents } from "./hooks/use-workspace-events";
import { useWorkspaceSelection } from "./hooks/use-workspace-selection";
import { useCliproxyAccounts } from "./hooks/use-cliproxy-accounts";
import { useProxySettings } from "./hooks/use-proxy-settings";
import { useServerMetrics } from "./hooks/use-server-metrics";
import { useTerminalEvents } from "./hooks/use-terminal-events";
import { useRuntimeServices } from "./hooks/use-runtime-services";
import { useRuntimeVersion } from "./hooks/use-runtime-version";
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
    useProjectGit(setError, invalidateProjectCatalog);
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
  } = useProjectFiles(setError, refreshGitAndProjectsAfterWorkspaceMutation);
  const {
    overview: settingsOverview,
    activeFile: settingsActiveFile,
    setActiveFile: setSettingsActiveFile,
    loadOverview: loadSettingsOverview,
    openFile: openSettingsFile,
    saveActiveFile: saveSettingsFile,
    createFile: createSettingsFile
  } = useOpenCodeSettings(setError, refreshGitAndProjectsAfterWorkspaceMutation);
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
    setActiveId(null); setActiveTab("projects"); resetFiles(); setSettingsActiveFile(null);
  };
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
  const { snapshot: runtimeServices, isLoading: isRuntimeServicesLoading, restartingByService, loadSnapshot: loadRuntimeServices, restartService: restartRuntimeService } = useRuntimeServices(setError);
  const {
    snapshot: runtimeVersion,
    isLoading: isRuntimeVersionLoading,
    isChecking: isRuntimeVersionChecking,
    isUpdating: isRuntimeUpdating,
    isRollingBack: isRuntimeRollingBack,
    isReconnecting: isRuntimeReconnecting,
    lastResult: runtimeVersionLastResult,
    updateState: runtimeUpdateState,
    loadSnapshot: loadRuntimeVersion,
    checkLatest: checkRuntimeVersion,
    updateRuntime,
    rollbackRuntime
  } = useRuntimeVersion(setError);
  const {
    snapshot: proxySettings,
    isLoading: isProxySettingsLoading,
    isSaving: isProxySettingsSaving,
    isApplying: isProxySettingsApplying,
    isTesting: isProxySettingsTesting,
    applyResult: proxyApplyResult,
    testResult: proxyTestResult,
    loadSettings: loadProxySettings,
    saveSettings: saveProxySettings,
    applySettings: applyProxySettings,
    testSettings: testProxySettings
  } = useProxySettings(setError);
  const {
    state: cliproxyAccounts,
    isLoading: isCliproxyAccountsLoading,
    isSubmitting: isCliproxyAccountsSubmitting,
    oauthStart: cliproxyOAuthStart,
    loadState: loadCliproxyAccounts,
    startOAuth: startCliproxyOAuth,
    clearOAuth: clearCliproxyOAuth,
    completeOAuth: completeCliproxyOAuth,
    testAccount: testCliproxyAccount,
    activateAccount: activateCliproxyAccount,
    deleteAccount: deleteCliproxyAccount
  } = useCliproxyAccounts(setError, refreshProvidersSurface);
  const { createProjectFolder, cloneProjectRepository, deleteProjectFolder } = useProjectWorkspace(setError, loadProjects, clearActiveSelection);
  const {
    restartOpenCodeState,
    syncOpenCodeAtStartup,
    syncOpenCodeNow,
    restartOpenCodeNow
  } = useOpenCodeAdminActions({
    setError,
    activeId,
    loadProjects,
    loadSettingsOverview,
    checkOpenCodeVersionStatus,
    refreshSettingsSurface
  });
  const { runContainerAction, sendTerminal, runAction } = useWorkspaceRuntimeActions({
    setError,
    terminalInput,
    setTerminalInput,
    loadProjects,
    loadStatus
  });

  async function invalidateProjectCatalog(_projectId: string): Promise<void> { await loadProjects(); }

  async function refreshGitAndProjectsAfterWorkspaceMutation(projectId: string | null): Promise<void> {
    /* File/settings edits change the repo state and must invalidate both GitHub tab and Projects cards. */
    if (!projectId) {
      return;
    }

    await Promise.all([loadGitOverview(projectId), loadProjects()]);
  }

  async function refreshProvidersSurface(): Promise<void> {
    /* CLIProxy account mutations can change both the account list and top-level provider badges. */
    await Promise.all([loadProviderOverview(), loadProxySettings()]);
  }

  async function refreshSettingsSurface(projectId: string | null): Promise<void> {
    /* Manual settings reload/restart should refresh every visible diagnostics slice as one batch. */
    const requests: Array<Promise<void>> = [
        loadSettingsOverview(projectId),
        checkOpenCodeVersionStatus(),
        loadGithubAuthStatus(),
        loadServerMetrics(),
        loadRuntimeServices(),
        checkRuntimeVersion()
      ];

    if (canControlTelegramStream) {
      requests.push(loadVoiceControlSettings());
    }

    await Promise.all(requests);
  }

  useEffect(() => { void (async () => { await syncOpenCodeAtStartup(); await loadProjects(); await restoreActiveProject(); })(); }, []);

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

  useReactiveWorkspaceSync({
    activeTab,
    activeId,
    filePath,
    loadProjects,
    loadGitOverview,
    loadFiles,
    loadSettingsOverview,
    loadOpenCodeVersionStatus,
    loadVoiceControlSettings,
    loadGithubAuthStatus,
    loadServerMetrics,
    loadRuntimeServices,
    checkRuntimeVersion,
    loadProviderOverview,
    loadProxySettings,
    loadCliproxyAccounts
  });

  useWorkspaceEvents({
    activeTab,
    activeId,
    filePath,
    onProjectsChanged: loadProjects,
    onGitChanged: loadGitOverview,
    onFilesChanged: loadFiles,
    onSettingsChanged: refreshSettingsSurface,
    onProvidersChanged: refreshProvidersSurface
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
          onSetTab={setActiveTab}
        />

        {error ? <div className="alert">{error}</div> : null}

        <WorkspaceTabsContent
          activeTab={activeTab}
          activeId={activeId}
          activeProject={activeProject}
          visibleProjects={visibleProjects}
          query={query}
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
          onCreateProjectFolder={(name) => void createProjectFolder(name)}
          onCloneRepository={(repositoryUrl, folderName) => void cloneProjectRepository(repositoryUrl, folderName)}
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
          onOpenSettingsFile={(kind, relativePath) => void openSettingsFile(kind, activeId, relativePath)}
          onCreateSettingsFile={(kind, name) => void createSettingsFile(kind, activeId, name)}
          onSaveSettingsFile={(content) => saveSettingsFile(activeId, content)}
          onDeleteActiveProject={async () => {
            if (!activeId) {
              return;
            }
            await deleteProjectFolder(activeId);
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
          serverMetrics={{ snapshot: serverMetrics, isLoading: isServerMetricsLoading }}
          runtimeServices={{ snapshot: runtimeServices, isLoading: isRuntimeServicesLoading, restartingByService }}
          runtimeVersion={{
            snapshot: runtimeVersion,
            isLoading: isRuntimeVersionLoading,
            isChecking: isRuntimeVersionChecking,
            isUpdating: isRuntimeUpdating,
            isRollingBack: isRuntimeRollingBack,
            isReconnecting: isRuntimeReconnecting,
            updateState: runtimeUpdateState,
            lastResult: runtimeVersionLastResult
          }}
          onReloadServerMetrics={() => void loadServerMetrics()}
          onReloadRuntimeServices={() => void loadRuntimeServices()}
          onRestartRuntimeService={(serviceId) => void restartRuntimeService(serviceId)}
          onCheckRuntimeVersion={() => void checkRuntimeVersion()}
          onUpdateRuntime={() => void updateRuntime()}
          onRollbackRuntime={() => void rollbackRuntime()}
          iconForEntry={(name, kind) => iconForFileEntry(name, kind)}
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
            isTesting: isProxySettingsTesting,
            applyResult: proxyApplyResult,
            testResult: proxyTestResult,
            cliproxyAccounts,
            cliproxyOAuthStart,
            isCliproxyLoading: isCliproxyAccountsLoading,
            isCliproxySubmitting: isCliproxyAccountsSubmitting,
            onSave: (input) => void saveProxySettings(input),
            onTest: (input) => void testProxySettings(input),
            onApply: () => void applyProxySettings(),
            onStartCliproxyAuth: (provider) => void startCliproxyOAuth(provider),
            onCloseCliproxyAuthModal: () => clearCliproxyOAuth(),
            onCompleteCliproxyAuth: (input) => void completeCliproxyOAuth(input),
            onTestCliproxyAccount: (accountId) => void testCliproxyAccount(accountId),
            onActivateCliproxyAccount: (accountId) => void activateCliproxyAccount(accountId),
            onDeleteCliproxyAccount: (accountId) => deleteCliproxyAccount(accountId)
          }}
        />
      </section>
    </div>
  );
};
