/**
 * @fileoverview Tab content switcher for workspace main panels.
 *
 * Exports:
 * - WorkspaceTabsContent - Renders active tab body with required callbacks.
 */

import { ContainersTab } from "./ContainersTab";
import { FilesTab } from "./FilesTab";
import { GitHubTab, GitOverview } from "./GitHubTab";
import { ProjectsTab } from "./ProjectsTab";
import { ProvidersTab } from "./ProvidersTab";
import { SettingsTab } from "./SettingsTab";
import { TerminalTab } from "./TerminalTab";
import { TabKey } from "./WorkspaceHeader";
import {
  ContainerAction,
  FileListResponse,
  FileReadResponse,
  GroqTranscriptionModel,
  OpenCodeSettingsKind,
  OpenCodeSettingsOverview,
  OpenCodeVersionStatus,
  ProviderOverview,
  ProjectGitSummary,
  ProjectRecord,
  ProjectStatus
} from "../types";

type Props = {
  activeTab: TabKey;
  activeId: string | null;
  visibleProjects: ProjectRecord[];
  query: string;
  telegramStreamEnabled: boolean;
  statusMap: Record<string, ProjectStatus[]>;
  gitSummaryMap: Record<string, ProjectGitSummary | null>;
  logsMap: Record<string, string>;
  filePath: string;
  fileList: FileListResponse | null;
  filePreview: FileReadResponse | null;
  filePreviewHtml: string;
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
  onCreateProjectFolder: (name: string) => void;
  onCloneRepository: (repositoryUrl: string, folderName?: string) => void;
  onRunComposeAction: (action: ContainerAction) => void;
  onRunContainerAction: (service: string, action: ContainerAction) => void;
  onLoadLogs: () => void;
  onFilesUp: () => void;
  onFilesRefresh: () => void;
  onOpenEntry: (nextPath: string, kind: "file" | "dir") => void;
  onInputChange: (value: string) => void;
  onSendTerminal: () => void;
  onChangeTheme: (mode: "light" | "dark") => void;
  onRefreshProjects: () => void;
  onSyncProjects: () => void;
  onRestartOpenCode: () => void;
  onLoadSettingsOverview: () => void;
  onOpenSettingsFile: (kind: OpenCodeSettingsKind, relativePath?: string) => void;
  onCreateSettingsFile: (kind: OpenCodeSettingsKind, name?: string) => void;
  onSaveSettingsFile: (content: string) => Promise<void> | void;
  onDeleteActiveProject: () => void;
  restartOpenCodeState: {
    isRestarting: boolean;
    lastResult: "idle" | "success" | "error";
  };
  voiceControl?: {
    apiKey: string;
    model: GroqTranscriptionModel | null;
    supportedModels: GroqTranscriptionModel[];
    isLoading: boolean;
    isSaving: boolean;
  };
  onVoiceControlApiKeyChange?: (value: string) => void;
  onVoiceControlModelChange?: (value: GroqTranscriptionModel | null) => void;
  onReloadVoiceControl?: () => void;
  onSaveVoiceControl?: () => void;
  openCodeVersion: {
    status: OpenCodeVersionStatus | null;
    isLoading: boolean;
    isUpdating: boolean;
  };
  onUpdateOpenCodeVersion: () => void;
  iconForEntry: (kind: "file" | "dir", name: string) => JSX.Element;
  onGitRefresh: () => void;
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
    onRefresh: () => void;
    onStartConnect: (input: { providerID: string; methodIndex: number }) => void;
    onSubmitApiKey: (input: { providerID: string; key: string }) => void;
    onSubmitOAuthCode: () => void;
    onCompleteOAuthAuto: () => void;
    onDisconnect: (providerID: string) => void;
    onChangeOAuthCodeDraft: (value: string) => void;
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
        onCreateProjectFolder={props.onCreateProjectFolder}
        onCloneRepository={props.onCloneRepository}
      />
    );
  }

  if (props.activeTab === "containers") {
    return (
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
    return (
      <FilesTab
        activeId={props.activeId}
        filePath={props.filePath}
        fileList={props.fileList}
        filePreview={props.filePreview}
        filePreviewHtml={props.filePreviewHtml}
        iconForEntry={props.iconForEntry}
        onUp={props.onFilesUp}
        onRefresh={props.onFilesRefresh}
        onOpenEntry={props.onOpenEntry}
      />
    );
  }

  if (props.activeTab === "terminal") {
    return (
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
    return (
      <GitHubTab
        activeId={props.activeId}
        overview={props.gitOverview}
        onRefresh={props.onGitRefresh}
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
    return (
      <ProvidersTab
        selected={props.providerOverview?.selected ?? null}
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
      />
    );
  }

  return (
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
      restartOpenCodeState={props.restartOpenCodeState}
      voiceControl={props.voiceControl}
      onVoiceControlApiKeyChange={props.onVoiceControlApiKeyChange}
      onVoiceControlModelChange={props.onVoiceControlModelChange}
      onReloadVoiceControl={props.onReloadVoiceControl}
      onSaveVoiceControl={props.onSaveVoiceControl}
      openCodeVersion={props.openCodeVersion}
      onUpdateOpenCodeVersion={props.onUpdateOpenCodeVersion}
    />
  );
};
