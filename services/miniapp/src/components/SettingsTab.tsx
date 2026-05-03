/**
 * @fileoverview Settings accordion with OpenCode rules/config editors.
 *
 * Exports:
 * - SettingsTab - Renders sectioned settings UI and embedded file editor.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CliproxyAccountState,
  ManagedRuntimeServiceId,
  GithubAuthStatus,
  OpenCodeSettingsKind,
  OpenCodeSettingsOverview,
  ProjectRuntimeSettingsPatch,
  ProjectRuntimeSnapshot,
  OpenCodeVersionStatus,
  RuntimeServicesSnapshot,
  RuntimeUpdateState,
  RuntimeVersionSnapshot,
  SystemMetricsSnapshot,
  SettingsFileSummary,
  VoiceControlSettings
} from "../types";
import { inferTextEditorLanguage } from "../utils/text-editor-language";
import { SettingsRuntimeDashboard } from "./SettingsRuntimeDashboard";
import { RuntimeVersionSettingsAccordion } from "./RuntimeVersionSettingsAccordion";
import { ThemeMode } from "../utils/theme";
import { GitHubAuthSettingsSection } from "./GitHubAuthSettingsSection";
import { ProjectRuntimeSettingsBlock } from "./ProjectRuntimeSettingsBlock";
import { ServerParametersAccordion } from "./ServerParametersAccordion";
import { SettingsProjectDangerZone } from "./SettingsProjectDangerZone";
import { SettingsEditorModal } from "./SettingsEditorModal";
import { ThemeModeToggle } from "./ThemeModeToggle";
import { VoiceControlSettingsSection } from "./VoiceControlSettingsSection";
import { AgentRulesSettingsAccordion } from "./AgentRulesSettingsAccordion";

type ActiveFile = {
  kind: OpenCodeSettingsKind;
  relativePath?: string;
  absolutePath: string;
  content: string;
  exists: boolean;
} | null;

type Props = {
  activeId: string | null;
  themeMode: ThemeMode;
  overview: OpenCodeSettingsOverview | null;
  activeFile: ActiveFile;
  onChangeTheme: (mode: ThemeMode) => void;
  onRefreshProjects: () => void;
  onSyncProjects: () => void;
  onRestartOpenCode: () => void;
  onLoadOverview?: () => void;
  onOpenFile: (kind: OpenCodeSettingsKind, relativePath?: string) => void;
  onCreateFile: (kind: OpenCodeSettingsKind, name?: string) => void;
  onSaveActiveFile: (content: string) => Promise<void> | void;
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
    model: VoiceControlSettings["model"];
    supportedModels: VoiceControlSettings["supportedModels"];
    isLoading: boolean;
    isSaving: boolean;
    saveResult: "idle" | "success" | "error";
  };
  onVoiceControlApiKeyChange?: (value: string) => void;
  onVoiceControlModelChange?: (value: VoiceControlSettings["model"]) => void;
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
  openCodeVersion?: {
    status: OpenCodeVersionStatus | null;
    isLoading: boolean;
    isUpdating: boolean;
  };
  onUpdateOpenCodeVersion?: () => void;
  serverMetrics?: { snapshot: SystemMetricsSnapshot | null; isLoading: boolean };
  onReloadServerMetrics?: () => void;
  runtimeServices?: { snapshot: RuntimeServicesSnapshot | null; isLoading: boolean; restartingByService: Partial<Record<ManagedRuntimeServiceId, boolean>> };
  runtimeVersion?: {
    snapshot: RuntimeVersionSnapshot | null;
    isLoading: boolean;
    isChecking: boolean;
    isUpdating: boolean;
    isRollingBack: boolean;
    isReconnecting: boolean;
    lastResult: "idle" | "updated" | "rolled-back" | "noop";
    updateState: RuntimeUpdateState | null;
  };
  proxyState?: {
    snapshot: import("../types").ProxySettingsSnapshot | null;
    accounts: CliproxyAccountState | null;
    isApplying: boolean;
  };
  onReloadRuntimeServices?: () => void;
  onRestartRuntimeService?: (serviceId: ManagedRuntimeServiceId) => void;
  onCheckRuntimeVersion?: () => void;
  onUpdateRuntime?: () => void;
  onRollbackRuntime?: () => void;
  onApplyProxyRuntime?: () => void;
};

export const SettingsTab = (props: Props) => {
  const [draft, setDraft] = useState<string>("");
  const [createNameByKind, setCreateNameByKind] = useState<Record<string, string>>({});
  const [isEditorOpen, setIsEditorOpen] = useState<boolean>(false);
  const [voiceToast, setVoiceToast] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [isEditorSaving, setIsEditorSaving] = useState<boolean>(false);
  const [editorSaveResult, setEditorSaveResult] = useState<"idle" | "success" | "error">("idle");
  const hasMountedRef = useRef<boolean>(false);

  const language = useMemo(() => {
    /* Reuse shared file-extension mapping so settings editors and file previews behave consistently. */
    const name = props.activeFile?.relativePath ?? props.activeFile?.absolutePath ?? "";
    return inferTextEditorLanguage(name);
  }, [props.activeFile]);

  useEffect(() => {
    /* Reset editor draft when another file is opened. */
    setDraft(props.activeFile?.content ?? "");
  }, [props.activeFile?.absolutePath, props.activeFile?.content]);

  useEffect(() => {
    /* Reset editor save status whenever another file becomes active. */
    setIsEditorSaving(false);
    setEditorSaveResult("idle");
  }, [props.activeFile?.absolutePath]);

  useEffect(() => {
    /*
     * Open editor only for updates after initial mount.
     * This prevents stale activeFile state from auto-opening modal when user simply
     * navigates back to the Settings tab.
     */
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (!props.activeFile) {
      setIsEditorOpen(false);
      return;
    }

    setIsEditorOpen(true);
  }, [props.activeFile]);

  useEffect(() => {
    /* Prevent background scroll while fullscreen editor modal is open. */
    if (!isEditorOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isEditorOpen]);

  useEffect(() => {
    /* Close editor with Escape for fast keyboard workflow. */
    if (!isEditorOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      setIsEditorOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isEditorOpen]);

  useEffect(() => {
    /* Show short toast after save attempt to make persistence feedback explicit. */
    if (!props.voiceControl || props.voiceControl.saveResult === "idle") {
      return;
    }

    if (props.voiceControl.saveResult === "success") {
      setVoiceToast({ kind: "success", message: "Voice settings saved." });
    } else {
      setVoiceToast({ kind: "error", message: "Failed to save voice settings." });
    }

    const timer = window.setTimeout(() => setVoiceToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [props.voiceControl?.saveResult]);

  const renderListSection = (input: {
    title: string;
    kind: OpenCodeSettingsKind;
    items: SettingsFileSummary[];
    emptyText: string;
  }) => {
    /* Reusable block for agents/commands/skills/plugins. */
    const createName = createNameByKind[input.kind] ?? "";
    return (
      <details className="settings-accordion-item">
        <summary>{input.title}</summary>
        <div className="settings-accordion-body">
          {input.items.length === 0 ? <div className="placeholder">{input.emptyText}</div> : null}

          {input.items.map((item) => (
            <button
              key={`${input.kind}:${item.relativePath}`}
              className="btn outline"
              onClick={() => {
                props.onOpenFile(input.kind, item.relativePath);
              }}
              type="button"
            >
              {item.relativePath}
            </button>
          ))}

          <div className="settings-create-row">
            <input
              className="input"
              placeholder="filename.ext"
              value={createName}
              onChange={(event) =>
                setCreateNameByKind((prev) => ({ ...prev, [input.kind]: event.target.value }))
              }
            />
            <button className="btn" onClick={() => props.onCreateFile(input.kind, createName)} type="button">
              Create
            </button>
          </div>
        </div>
      </details>
    );
  };

  const isEditorDirty = Boolean(props.activeFile && draft !== props.activeFile.content);

  const saveEditorDraft = async (): Promise<void> => {
    /* Save action is guarded to prevent duplicate requests on rapid clicks/hotkeys. */
    if (isEditorSaving) {
      return;
    }

    try {
      setIsEditorSaving(true);
      setEditorSaveResult("idle");
      await Promise.resolve(props.onSaveActiveFile(draft));
      setEditorSaveResult("success");
    } catch {
      setEditorSaveResult("error");
    } finally {
      setIsEditorSaving(false);
    }
  };

  return (
    <section className="settings-shell">
      {props.runtimeServices ? (
        <SettingsRuntimeDashboard
          overview={props.overview}
          openCodeVersion={props.openCodeVersion}
          restartOpenCodeState={props.restartOpenCodeState}
          runtimeServices={props.runtimeServices}
          proxyState={props.proxyState}
          onReloadRuntimeServices={props.onReloadRuntimeServices ?? (() => {})}
          onRestartRuntimeService={props.onRestartRuntimeService}
          onApplyProxyRuntime={props.onApplyProxyRuntime}
          onOpenFile={(kind) => props.onOpenFile(kind)}
          onRefreshProjects={props.onRefreshProjects}
          onSyncProjects={props.onSyncProjects}
          onRestartOpenCode={props.onRestartOpenCode}
          onUpdateOpenCodeVersion={props.onUpdateOpenCodeVersion}
        />
      ) : null}

      <RuntimeVersionSettingsAccordion
        runtimeVersion={props.runtimeVersion}
        onCheckRuntimeVersion={props.onCheckRuntimeVersion}
        onUpdateRuntime={props.onUpdateRuntime}
        onRollbackRuntime={props.onRollbackRuntime}
      />

      <AgentRulesSettingsAccordion
        activeId={props.activeId}
        overview={props.overview}
        onOpenFile={props.onOpenFile}
        onCreateFile={props.onCreateFile}
      />

      {renderListSection({
        title: "3. Agents",
        kind: "agent",
        items: props.overview?.agents ?? [],
        emptyText: "Agents folder is empty. Create a new .md file."
      })}

      <details className="settings-accordion-item">
        <summary>4. OpenCode config</summary>
        <div className="settings-accordion-body">
          <button className="btn outline" onClick={() => props.onOpenFile("config")} type="button">
            OpenCode config
          </button>
          {!props.overview?.config.exists ? (
            <button className="btn" onClick={() => props.onCreateFile("config")} type="button">
              Create opencode.json
            </button>
          ) : null}

          <div className="settings-actions-grid">
            <button className="btn outline" onClick={props.onRefreshProjects} type="button">
              Refresh project list
            </button>
            <button className="btn outline" onClick={props.onSyncProjects} type="button">
              Sync OpenCode
            </button>
            <button
              className="btn outline"
              onClick={props.onRestartOpenCode}
              disabled={props.restartOpenCodeState.isRestarting}
              type="button"
            >
              {props.restartOpenCodeState.isRestarting ? "Restarting..." : "Restart OpenCode"}
            </button>
            <button
              className="btn outline"
              onClick={props.onUpdateOpenCodeVersion}
              disabled={!props.openCodeVersion?.status?.updateAvailable || props.openCodeVersion?.isUpdating}
              type="button"
            >
              {props.openCodeVersion?.isUpdating ? "Updating..." : "Update OpenCode"}
            </button>
          </div>

          <div className="project-create-note">
            OpenCode: {props.openCodeVersion?.status?.currentVersion ?? "unknown"}
          </div>
          <div className="project-create-note">
            Latest: {props.openCodeVersion?.status?.latestVersion ?? "not checked yet"}
            {props.openCodeVersion?.isLoading ? " (checking...)" : ""}
          </div>
          {props.openCodeVersion?.status?.updateAvailable ? (
            <div className="project-create-note">Update is available. Click Update OpenCode.</div>
          ) : null}
          {props.restartOpenCodeState.lastResult === "success" ? (
            <div className="project-create-note">OpenCode restarted successfully.</div>
          ) : null}
          {props.restartOpenCodeState.lastResult === "error" ? (
            <div className="project-create-note">Failed to restart OpenCode. Check backend logs.</div>
          ) : null}
        </div>
      </details>

      {renderListSection({
        title: "5. Commands",
        kind: "command",
        items: props.overview?.commands ?? [],
        emptyText: "Global commands folder is empty. Create a new .md file."
      })}

      <details className="settings-accordion-item">
        <summary>6. Project settings</summary>
        <div className="settings-accordion-body">
          {props.activeId ? (
            <>
              <ProjectRuntimeSettingsBlock
                activeId={props.activeId}
                snapshot={props.projectRuntime.snapshot}
                isLoading={props.projectRuntime.isLoading}
                isSaving={props.projectRuntime.isSaving}
                onSaveSettings={props.onSaveProjectRuntimeSettings}
              />

              {(props.overview?.projectEnvFiles ?? []).length === 0 ? (
                <div className="placeholder">No env files found in this project.</div>
              ) : null}

              {(props.overview?.projectEnvFiles ?? []).map((item) => (
                <button
                  key={`project-env:${item.relativePath}`}
                  className="btn outline"
                  onClick={() => props.onOpenFile("projectEnvFile", item.relativePath)}
                  type="button"
                >
                  {item.relativePath}
                </button>
              ))}

              {!props.overview?.projectEnv?.exists ? (
                <button className="btn" onClick={() => props.onCreateFile("projectEnv")} type="button">
                  Create .env
                </button>
              ) : null}

              <SettingsProjectDangerZone
                activeProjectId={props.activeId}
                onDeleteActiveProject={props.onDeleteActiveProject}
              />
            </>
          ) : (
            <SettingsProjectDangerZone activeProjectId={null} onDeleteActiveProject={props.onDeleteActiveProject} />
          )}
        </div>
      </details>

      <VoiceControlSettingsSection
        voiceControl={props.voiceControl}
        onVoiceControlApiKeyChange={props.onVoiceControlApiKeyChange}
        onVoiceControlModelChange={props.onVoiceControlModelChange}
        onReloadVoiceControl={props.onReloadVoiceControl}
        onSaveVoiceControl={props.onSaveVoiceControl}
      />

      <GitHubAuthSettingsSection
        status={props.githubAuth?.status ?? null}
        tokenDraft={props.githubAuth?.tokenDraft ?? ""}
        isLoading={props.githubAuth?.isLoading ?? false}
        isSaving={props.githubAuth?.isSaving ?? false}
        isDisconnecting={props.githubAuth?.isDisconnecting ?? false}
        onReload={props.onReloadGithubAuth ?? (() => {})}
        onTokenDraftChange={props.onGithubTokenDraftChange ?? (() => {})}
        onSaveToken={props.onSaveGithubToken ?? (() => {})}
        onDisconnect={props.onDisconnectGithubAuth ?? (() => {})}
      />

      {voiceToast ? (
        <div
          className={voiceToast.kind === "success" ? "settings-toast success" : "settings-toast error"}
          role="status"
          aria-live="polite"
        >
          {voiceToast.message}
        </div>
      ) : null}

      <ServerParametersAccordion
        metrics={props.serverMetrics?.snapshot ?? null}
        isLoading={props.serverMetrics?.isLoading ?? false}
        onReload={props.onReloadServerMetrics ?? (() => {})}
      />

      <details className="settings-accordion-item">
        <summary>10. General settings</summary>
        <div className="settings-accordion-body">
          <ThemeModeToggle themeMode={props.themeMode} onChangeTheme={props.onChangeTheme} />
        </div>
      </details>

      <SettingsEditorModal
        isOpen={Boolean(props.activeFile && isEditorOpen)}
        filePath={props.activeFile?.absolutePath ?? ""}
        language={language}
        themeMode={props.themeMode}
        draft={draft}
        isDirty={isEditorDirty}
        isSaving={isEditorSaving}
        saveResult={editorSaveResult}
        onChange={setDraft}
        onClose={() => setIsEditorOpen(false)}
        onSave={() => void saveEditorDraft()}
      />
    </section>
  );
};
