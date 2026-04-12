/**
 * @fileoverview Tab content switcher for workspace main panels.
 *
 * Exports:
 * - WorkspaceTabsContent - Renders active tab body with required callbacks.
 */

import { JSX, lazy, Suspense } from "react";

import type { GitOverview } from "./GitHubTab";
import { ProjectsTab } from "./ProjectsTab";
import { TabKey } from "./WorkspaceHeader";
import {
  ContainerAction,
  CliproxyAccountState,
  CliproxyOAuthStartPayload,
  CliproxyProviderState,
  FileListResponse,
  FileReadResponse,
  GithubAuthStatus,
  GroqTranscriptionModel,
  OpenCodeSettingsKind,
  OpenCodeSettingsOverview,
  OpenCodeVersionStatus,
  ProviderOverview,
  ProxyApplyResult,
  ProxySettingsInput,
  ProxySettingsSnapshot,
  RuntimeServicesSnapshot,
  SystemMetricsSnapshot,
  ProjectGitSummary,
  ProjectRecord,
  ProjectRuntimeSettingsPatch,
  ProjectRuntimeSnapshot,
  ManagedRuntimeServiceId,
  ProjectStatus
} from "../types";

const ContainersTab = lazy(async () => ({ default: (await import("./ContainersTab")).ContainersTab }));
const FilesTab = lazy(async () => ({ default: (await import("./FilesTab")).FilesTab }));
const GitHubTab = lazy(async () => ({ default: (await import("./GitHubTab")).GitHubTab }));
const ProvidersTab = lazy(async () => ({ default: (await import("./ProvidersTab")).ProvidersTab }));
const SettingsTab = lazy(async () => ({ default: (await import("./SettingsTab")).SettingsTab }));
const TerminalTab = lazy(async () => ({ default: (await import("./TerminalTab")).TerminalTab }));
const KanbanProjectTab = lazy(async () => ({ default: (await import("./KanbanProjectTab")).KanbanProjectTab }));

const TAB_LOADING_MESSAGE = "Загрузка вкладки...";

const renderLazyTab = (content: JSX.Element): JSX.Element => {
  /* Lazy tab boundary keeps heavy editors and provider screens out of the initial Mini App bundle. */
  return <Suspense fallback={<div className="placeholder">{TAB_LOADING_MESSAGE}</div>}>{content}</Suspense>;
};

type Props = {
  activeTab: TabKey;
  activeId: string | null;
  activeProject: ProjectRecord | null;
  visibleProjects: ProjectRecord[];
  query: string;
  telegramStreamEnabled: boolean;
  statusMap: Record<string, ProjectStatus[]>;
  gitSummaryMap: Record<string, ProjectGitSummary | null>;
  logsMap: Record<string, string>;
  filePath: string;
  fileList: FileListResponse | null;
  filePreview: FileReadResponse | null;
  terminalBuffer: string;
  terminalInput: string;
  themeMode: "light" | "dark";
  gitOverview: GitOverview | null | undefined;
  providerOverview: ProviderOverview | null;
  settingsOverview: OpenCodeSettingsOverview | null;
  settingsActiveFile: {
    kind: OpenCodeSettingsKind;
    relativePath?: string;
    absolutePath: string;
    content: string;
    exists: boolean;
  } | null;
  onQueryChange: (value: string) => void;
  onSelectProject: (id: string) => void;
  onDeployProject: (id: string) => void;
  onStopProjectDeploy: (id: string) => void;
  onCreateProjectFolder: (name: string) => void;
  onCloneRepository: (repositoryUrl: string, folderName?: string) => void;
  onRunComposeAction: (action: ContainerAction) => void;
  onRunContainerAction: (service: string, action: ContainerAction) => void;
  onLoadLogs: () => void;
  onFilesUp: () => void;
  onOpenEntry: (nextPath: string, kind: "file" | "dir") => void;
  onCloseFilePreview: () => void;
  onDownloadFilePreview: (relativePath: string) => Promise<void> | void;
  onUploadFileFromDevice: (currentPath: string, file: File) => Promise<void> | void;
  onImportFileFromUrl: (currentPath: string, url: string) => Promise<void> | void;
  onInputChange: (value: string) => void;
  onSendTerminal: () => void;
  onChangeTheme: (mode: "light" | "dark") => void;
  onRefreshProjects: () => void;
  onSyncProjects: () => void;
  onRestartOpenCode: () => void;
  onLoadSettingsOverview?: () => void;
  onOpenSettingsFile: (kind: OpenCodeSettingsKind, relativePath?: string) => void;
  onCreateSettingsFile: (kind: OpenCodeSettingsKind, name?: string) => void;
  onSaveSettingsFile: (content: string) => Promise<void> | void;
  onDeleteActiveProject: () => Promise<void> | void;
  projectRuntime: {
    snapshot: ProjectRuntimeSnapshot | null;
    isLoading: boolean;
    isSaving: boolean;
  };
  onSaveProjectRuntimeSettings: (patch: ProjectRuntimeSettingsPatch) => void;
  restartOpenCodeState: {
    isRestarting: boolean;
    lastResult: "idle" | "success" | "error";
  };
  voiceControl?: {
    apiKey: string;
    hasApiKey: boolean;
    model: GroqTranscriptionModel | null;
    supportedModels: GroqTranscriptionModel[];
    isLoading: boolean;
    isSaving: boolean;
    saveResult: "idle" | "success" | "error";
  };
  onVoiceControlApiKeyChange?: (value: string) => void;
  onVoiceControlModelChange?: (value: GroqTranscriptionModel | null) => void;
  onReloadVoiceControl?: () => void;
  onSaveVoiceControl?: () => void;
  githubAuth?: {
    status: GithubAuthStatus | null;
    tokenDraft: string;
    isLoading: boolean;
    isSaving: boolean;
    isDisconnecting: boolean;
  };
  onReloadGithubAuth?: () => void;
  onGithubTokenDraftChange?: (value: string) => void;
  onSaveGithubToken?: () => void;
  onDisconnectGithubAuth?: () => void;
  openCodeVersion: {
    status: OpenCodeVersionStatus | null;
    isLoading: boolean;
    isUpdating: boolean;
  };
  serverMetrics?: {
    snapshot: SystemMetricsSnapshot | null;
    isLoading: boolean;
  };
  runtimeServices?: {
    snapshot: RuntimeServicesSnapshot | null;
    isLoading: boolean;
    restartingByService: Partial<Record<ManagedRuntimeServiceId, boolean>>;
  };
  onReloadRuntimeServices?: () => void;
  onRestartRuntimeService?: (serviceId: ManagedRuntimeServiceId) => void;
  onReloadServerMetrics?: () => void;
  onUpdateOpenCodeVersion: () => void;
  iconForEntry: (name: string, kind: "file" | "dir") => JSX.Element;
  onGitCheckout: (branch: string) => void;
  onGitCommit: (message: string) => void;
  onGitFetch: () => void;
  onGitPull: () => void;
  onGitPush: () => void;
  onGitMerge: (sourceBranch: string) => void;
  providersState: {
    isLoading: boolean;
    isSubmitting: boolean;
    oauthState: {
      providerID: string;
      methodIndex: number;
      method: "auto" | "code";
      url: string;
      instructions: string;
      codeDraft: string;
    } | null;
     onRefresh?: () => void;
    onStartConnect: (input: { providerID: string; methodIndex: number }) => void;
    onSubmitApiKey: (input: { providerID: string; key: string }) => void;
    onSubmitOAuthCode: () => void;
    onCompleteOAuthAuto: () => void;
    onDisconnect: (providerID: string) => void;
    onChangeOAuthCodeDraft: (value: string) => void;
  };
  proxyState: {
    snapshot: ProxySettingsSnapshot | null;
    isLoading: boolean;
    isSaving: boolean;
    isApplying: boolean;
    isTesting: boolean;
    applyResult: ProxyApplyResult | null;
    testResult: import("../types").ProxySettingsTestResult | null;
    cliproxyAccounts: CliproxyAccountState | null;
    cliproxyOAuthStart: CliproxyOAuthStartPayload | null;
    isCliproxyLoading: boolean;
    isCliproxySubmitting: boolean;
     onReload?: () => void;
    onSave: (input: ProxySettingsInput) => void;
    onTest: (input: import("../types").ProxySettingsTestInput) => void;
    onApply: () => void;
    onReloadCliproxy?: () => void;
    onStartCliproxyAuth: (provider: CliproxyProviderState["id"]) => void;
    onCloseCliproxyAuthModal: () => void;
    onCompleteCliproxyAuth: (input: {
      provider: CliproxyProviderState["id"];
      callbackUrl?: string;
      code?: string;
      state?: string;
      error?: string;
    }) => void;
    onTestCliproxyAccount: (accountId: string) => void;
    onActivateCliproxyAccount: (accountId: string) => void;
    onDeleteCliproxyAccount: (accountId: string) => Promise<void> | void;
  };
};

export const WorkspaceTabsContent = (props: Props) => {
  /* Render exactly one active tab panel at a time. */
  if (props.activeTab === "projects") {
    return (
      <ProjectsTab
        visibleProjects={props.visibleProjects}
        activeId={props.activeId}
        query={props.query}
        telegramStreamEnabled={props.telegramStreamEnabled}
        statusMap={props.statusMap}
        gitSummaryMap={props.gitSummaryMap}
        onQueryChange={props.onQueryChange}
        onSelectProject={props.onSelectProject}
        onDeployProject={props.onDeployProject}
        onStopProjectDeploy={props.onStopProjectDeploy}
        onCreateProjectFolder={props.onCreateProjectFolder}
        onCloneRepository={props.onCloneRepository}
      />
    );
  }

  if (props.activeTab === "containers") {
    return renderLazyTab(
      <ContainersTab
        activeId={props.activeId}
        status={props.activeId ? props.statusMap[props.activeId] : undefined}
        logs={props.activeId ? props.logsMap[props.activeId] : undefined}
        onRunComposeAction={props.onRunComposeAction}
        onRunContainerAction={props.onRunContainerAction}
        onLoadLogs={props.onLoadLogs}
      />
    );
  }

  if (props.activeTab === "files") {
    return renderLazyTab(
      <FilesTab
        activeId={props.activeId}
        filePath={props.filePath}
        fileList={props.fileList}
        filePreview={props.filePreview}
        themeMode={props.themeMode}
        iconForEntry={props.iconForEntry}
        onUp={props.onFilesUp}
        onOpenEntry={props.onOpenEntry}
        onClosePreview={props.onCloseFilePreview}
        onDownloadPreview={props.onDownloadFilePreview}
        onUploadFromDevice={props.onUploadFileFromDevice}
        onImportFromUrl={props.onImportFileFromUrl}
      />
    );
  }

  if (props.activeTab === "tasks") {
    return renderLazyTab(<KanbanProjectTab activeProject={props.activeProject} themeMode={props.themeMode} />);
  }

  if (props.activeTab === "terminal") {
    return renderLazyTab(
      <TerminalTab
        activeId={props.activeId}
        buffer={props.terminalBuffer}
        input={props.terminalInput}
        onInputChange={props.onInputChange}
        onSend={props.onSendTerminal}
      />
    );
  }

  if (props.activeTab === "github") {
    return renderLazyTab(
      <GitHubTab
        activeId={props.activeId}
        overview={props.gitOverview}
        onCheckout={props.onGitCheckout}
        onCommit={props.onGitCommit}
        onFetch={props.onGitFetch}
        onPull={props.onGitPull}
        onPush={props.onGitPush}
        onMerge={props.onGitMerge}
      />
    );
  }

  if (props.activeTab === "providers") {
    return renderLazyTab(
      <ProvidersTab
        providers={props.providerOverview?.providers ?? []}
        authMethods={props.providerOverview?.authMethods ?? {}}
        isLoading={props.providersState.isLoading}
        isSubmitting={props.providersState.isSubmitting}
        oauthState={props.providersState.oauthState}
         onRefresh={props.providersState.onRefresh}
        onStartConnect={props.providersState.onStartConnect}
        onSubmitApiKey={props.providersState.onSubmitApiKey}
        onSubmitOAuthCode={props.providersState.onSubmitOAuthCode}
        onCompleteOAuthAuto={props.providersState.onCompleteOAuthAuto}
        onDisconnect={props.providersState.onDisconnect}
        onChangeOAuthCodeDraft={props.providersState.onChangeOAuthCodeDraft}
        cliproxyAccounts={props.proxyState.cliproxyAccounts}
        cliproxyOAuthStart={props.proxyState.cliproxyOAuthStart}
        isCliproxyLoading={props.proxyState.isCliproxyLoading}
        isCliproxySubmitting={props.proxyState.isCliproxySubmitting}
        proxySnapshot={props.proxyState.snapshot}
        isProxyLoading={props.proxyState.isLoading}
        isProxySaving={props.proxyState.isSaving}
        isProxyApplying={props.proxyState.isApplying}
        isProxyTesting={props.proxyState.isTesting}
        proxyApplyResult={props.proxyState.applyResult}
        proxyTestResult={props.proxyState.testResult}
         onReloadCliproxy={props.proxyState.onReloadCliproxy}
        onStartCliproxyAuth={props.proxyState.onStartCliproxyAuth}
        onCloseCliproxyAuthModal={props.proxyState.onCloseCliproxyAuthModal}
        onCompleteCliproxyAuth={props.proxyState.onCompleteCliproxyAuth}
        onTestCliproxyAccount={props.proxyState.onTestCliproxyAccount}
        onActivateCliproxyAccount={props.proxyState.onActivateCliproxyAccount}
        onDeleteCliproxyAccount={props.proxyState.onDeleteCliproxyAccount}
         onReloadProxy={props.proxyState.onReload}
        onSaveProxy={props.proxyState.onSave}
        onTestProxy={props.proxyState.onTest}
        onApplyProxy={props.proxyState.onApply}
      />
    );
  }

  return renderLazyTab(
    <SettingsTab
      activeId={props.activeId}
      themeMode={props.themeMode}
      overview={props.settingsOverview}
      activeFile={props.settingsActiveFile}
      onChangeTheme={props.onChangeTheme}
      onRefreshProjects={props.onRefreshProjects}
      onSyncProjects={props.onSyncProjects}
      onRestartOpenCode={props.onRestartOpenCode}
       onLoadOverview={props.onLoadSettingsOverview}
      onOpenFile={props.onOpenSettingsFile}
      onCreateFile={props.onCreateSettingsFile}
      onSaveActiveFile={props.onSaveSettingsFile}
      onDeleteActiveProject={props.onDeleteActiveProject}
      projectRuntime={props.projectRuntime}
      onSaveProjectRuntimeSettings={props.onSaveProjectRuntimeSettings}
      restartOpenCodeState={props.restartOpenCodeState}
      voiceControl={props.voiceControl}
      onVoiceControlApiKeyChange={props.onVoiceControlApiKeyChange}
      onVoiceControlModelChange={props.onVoiceControlModelChange}
      onReloadVoiceControl={props.onReloadVoiceControl}
      onSaveVoiceControl={props.onSaveVoiceControl}
      githubAuth={props.githubAuth}
      onReloadGithubAuth={props.onReloadGithubAuth}
      onGithubTokenDraftChange={props.onGithubTokenDraftChange}
      onSaveGithubToken={props.onSaveGithubToken}
      onDisconnectGithubAuth={props.onDisconnectGithubAuth}
       openCodeVersion={props.openCodeVersion}
       onUpdateOpenCodeVersion={props.onUpdateOpenCodeVersion}
       serverMetrics={props.serverMetrics}
       runtimeServices={props.runtimeServices}
       proxyState={props.proxyState.snapshot ? {
         snapshot: props.proxyState.snapshot,
         accounts: props.proxyState.cliproxyAccounts,
         isApplying: props.proxyState.isApplying
       } : {
         snapshot: null,
         accounts: props.proxyState.cliproxyAccounts,
         isApplying: props.proxyState.isApplying
       }}
       onReloadServerMetrics={props.onReloadServerMetrics}
       onReloadRuntimeServices={props.onReloadRuntimeServices}
       onRestartRuntimeService={props.onRestartRuntimeService}
       onApplyProxyRuntime={props.proxyState.onApply}
     />
   );
 };
