/**
 * @fileoverview UI tests for SettingsTab controls.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsTab } from "../SettingsTab";

describe("SettingsTab", () => {
  afterEach(() => {
    /* Reset DOM between tests to keep queries deterministic. */
    cleanup();
  });

  it("calls refresh callback from settings action", () => {
    /* Project list refresh is intentionally grouped under OpenCode config actions. */
    const onRefreshProjects = vi.fn();
    render(
      <SettingsTab
        activeId={null}
        themeMode="light"
        overview={null}
        activeFile={null}
        onChangeTheme={vi.fn()}
        onRefreshProjects={onRefreshProjects}
        onSyncProjects={vi.fn()}
        onRestartOpenCode={vi.fn()}
        onLoadOverview={vi.fn()}
        onOpenFile={vi.fn()}
        onCreateFile={vi.fn()}
        onSaveActiveFile={vi.fn()}
        onDeleteActiveProject={vi.fn()}
        projectRuntime={{ snapshot: null, isLoading: false, isSaving: false }}
        onSaveProjectRuntimeSettings={vi.fn()}
        restartOpenCodeState={{ isRestarting: false, lastResult: "idle" }}
      />
    );

    fireEvent.click(screen.getByText("3. OpenCode config"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh project list" }));
    expect(onRefreshProjects).toHaveBeenCalledTimes(1);
  });

  it("does not render Skills and Plugins sections", () => {
    /* Skills/plugins management is intentionally disabled in Mini App settings. */
    render(
      <SettingsTab
        activeId={null}
        themeMode="light"
        overview={null}
        activeFile={null}
        onChangeTheme={vi.fn()}
        onRefreshProjects={vi.fn()}
        onSyncProjects={vi.fn()}
        onRestartOpenCode={vi.fn()}
        onLoadOverview={vi.fn()}
        onOpenFile={vi.fn()}
        onCreateFile={vi.fn()}
        onSaveActiveFile={vi.fn()}
        onDeleteActiveProject={vi.fn()}
        projectRuntime={{ snapshot: null, isLoading: false, isSaving: false }}
        onSaveProjectRuntimeSettings={vi.fn()}
        restartOpenCodeState={{ isRestarting: false, lastResult: "idle" }}
      />
    );

    expect(screen.queryByText("5. Skills")).toBeNull();
    expect(screen.queryByText("6. Plugins")).toBeNull();
  });

  it("shows project env controls when a project is selected", () => {
    /* Project-scoped env editor should only appear with activeId context. */
    const onOpenFile = vi.fn();
    const onCreateFile = vi.fn();

    render(
      <SettingsTab
        activeId="demo"
        themeMode="light"
        overview={{
          globalRule: { exists: true, absolutePath: "/x/AGENTS.md" },
          projectRule: { exists: true, absolutePath: "/p/AGENTS.md" },
          projectEnv: { exists: false, absolutePath: "/p/.env" },
          projectEnvFiles: [
            { name: ".env", relativePath: ".env" },
            { name: ".env.local", relativePath: "apps/web/.env.local" }
          ],
          config: { exists: true, absolutePath: "/x/opencode.json" },
          agents: [],
          commands: []
        }}
        activeFile={null}
        onChangeTheme={vi.fn()}
        onRefreshProjects={vi.fn()}
        onSyncProjects={vi.fn()}
        onRestartOpenCode={vi.fn()}
        onLoadOverview={vi.fn()}
        onOpenFile={onOpenFile}
        onCreateFile={onCreateFile}
        onSaveActiveFile={vi.fn()}
        onDeleteActiveProject={vi.fn()}
        projectRuntime={{ snapshot: null, isLoading: false, isSaving: false }}
        onSaveProjectRuntimeSettings={vi.fn()}
        restartOpenCodeState={{ isRestarting: false, lastResult: "idle" }}
      />
    );

    fireEvent.click(screen.getByText("5. Project settings"));
    fireEvent.click(screen.getByRole("button", { name: ".env" }));
    expect(onOpenFile).toHaveBeenCalledWith("projectEnvFile", ".env");

    fireEvent.click(screen.getByRole("button", { name: "apps/web/.env.local" }));
    expect(onOpenFile).toHaveBeenCalledWith("projectEnvFile", "apps/web/.env.local");

    fireEvent.click(screen.getByRole("button", { name: "Create .env" }));
    expect(onCreateFile).toHaveBeenCalledWith("projectEnv");
  });

  it("updates project runtime mode from project settings accordion", () => {
    /* Deploy mode switch should be configurable without leaving Settings tab. */
    const onSaveProjectRuntimeSettings = vi.fn();
    render(
      <SettingsTab
        activeId="demo"
        themeMode="light"
        overview={null}
        activeFile={null}
        onChangeTheme={vi.fn()}
        onRefreshProjects={vi.fn()}
        onSyncProjects={vi.fn()}
        onRestartOpenCode={vi.fn()}
        onLoadOverview={vi.fn()}
        onOpenFile={vi.fn()}
        onCreateFile={vi.fn()}
        onSaveActiveFile={vi.fn()}
        onDeleteActiveProject={vi.fn()}
        projectRuntime={{
          snapshot: {
            slug: "demo",
            mode: "docker",
            serviceName: null,
            internalPort: null,
            staticRoot: null,
            availableServices: [],
            previewUrl: "https://demo.dev.example.com",
            deployed: false
          },
          isLoading: false,
          isSaving: false
        }}
        onSaveProjectRuntimeSettings={onSaveProjectRuntimeSettings}
        restartOpenCodeState={{ isRestarting: false, lastResult: "idle" }}
      />
    );

    fireEvent.click(screen.getByText("5. Project settings"));
    fireEvent.change(screen.getByLabelText("Run mode"), { target: { value: "static" } });
    fireEvent.change(screen.getByLabelText("Static root path"), { target: { value: "public" } });
    fireEvent.click(screen.getByRole("button", { name: "Save deploy settings" }));
    expect(onSaveProjectRuntimeSettings).toHaveBeenCalledWith({
      mode: "static",
      serviceName: null,
      internalPort: null,
      staticRoot: "public"
    });
  });

  it("renders advanced runtime fields for docker/static mode", () => {
    /* Project runtime settings should expose service/port/static root overrides in UI. */
    const onSaveProjectRuntimeSettings = vi.fn();
    render(
      <SettingsTab
        activeId="demo"
        themeMode="light"
        overview={null}
        activeFile={null}
        onChangeTheme={vi.fn()}
        onRefreshProjects={vi.fn()}
        onSyncProjects={vi.fn()}
        onRestartOpenCode={vi.fn()}
        onLoadOverview={vi.fn()}
        onOpenFile={vi.fn()}
        onCreateFile={vi.fn()}
        onSaveActiveFile={vi.fn()}
        onDeleteActiveProject={vi.fn()}
        projectRuntime={{
          snapshot: {
            slug: "demo",
            mode: "docker",
            serviceName: "web",
            internalPort: 8080,
            staticRoot: "public",
            availableServices: ["web", "api"],
            previewUrl: "https://demo.dev.example.com",
            deployed: false
          },
          isLoading: false,
          isSaving: false
        }}
        onSaveProjectRuntimeSettings={onSaveProjectRuntimeSettings}
        restartOpenCodeState={{ isRestarting: false, lastResult: "idle" }}
      />
    );

    fireEvent.click(screen.getByText("5. Project settings"));
    expect(screen.getByLabelText("Docker service name")).toBeTruthy();
    expect(screen.getByLabelText("Docker internal port")).toBeTruthy();
    expect(screen.getByLabelText("Static root path")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use web" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use api" }));
    expect(screen.getByRole("button", { name: "Save deploy settings" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Docker internal port"), { target: { value: "5173" } });
    fireEvent.click(screen.getByRole("button", { name: "Save deploy settings" }));
    expect(onSaveProjectRuntimeSettings).toHaveBeenCalledWith({
      mode: "docker",
      serviceName: "api",
      internalPort: 5173,
      staticRoot: "public"
    });
  });

  it("requires static root before saving static mode", () => {
    /* Frontend should block invalid static save requests before backend validation. */
    const onSaveProjectRuntimeSettings = vi.fn();
    render(
      <SettingsTab
        activeId="demo"
        themeMode="light"
        overview={null}
        activeFile={null}
        onChangeTheme={vi.fn()}
        onRefreshProjects={vi.fn()}
        onSyncProjects={vi.fn()}
        onRestartOpenCode={vi.fn()}
        onLoadOverview={vi.fn()}
        onOpenFile={vi.fn()}
        onCreateFile={vi.fn()}
        onSaveActiveFile={vi.fn()}
        onDeleteActiveProject={vi.fn()}
        projectRuntime={{
          snapshot: {
            slug: "demo",
            mode: "docker",
            serviceName: null,
            internalPort: null,
            staticRoot: null,
            availableServices: [],
            previewUrl: "https://demo.dev.example.com",
            deployed: false
          },
          isLoading: false,
          isSaving: false
        }}
        onSaveProjectRuntimeSettings={onSaveProjectRuntimeSettings}
        restartOpenCodeState={{ isRestarting: false, lastResult: "idle" }}
      />
    );

    fireEvent.click(screen.getByText("5. Project settings"));
    fireEvent.change(screen.getByLabelText("Run mode"), { target: { value: "static" } });
    expect(screen.getByText("Static mode requires static root path.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save deploy settings" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSaveProjectRuntimeSettings).not.toHaveBeenCalled();
  });

  it("blocks save when docker port value is invalid", () => {
    /* Port validation should fail fast in UI before calling backend. */
    const onSaveProjectRuntimeSettings = vi.fn();
    render(
      <SettingsTab
        activeId="demo"
        themeMode="light"
        overview={null}
        activeFile={null}
        onChangeTheme={vi.fn()}
        onRefreshProjects={vi.fn()}
        onSyncProjects={vi.fn()}
        onRestartOpenCode={vi.fn()}
        onLoadOverview={vi.fn()}
        onOpenFile={vi.fn()}
        onCreateFile={vi.fn()}
        onSaveActiveFile={vi.fn()}
        onDeleteActiveProject={vi.fn()}
        projectRuntime={{
          snapshot: {
            slug: "demo",
            mode: "docker",
            serviceName: "web",
            internalPort: null,
            staticRoot: null,
            availableServices: ["web"],
            previewUrl: "https://demo.dev.example.com",
            deployed: false
          },
          isLoading: false,
          isSaving: false
        }}
        onSaveProjectRuntimeSettings={onSaveProjectRuntimeSettings}
        restartOpenCodeState={{ isRestarting: false, lastResult: "idle" }}
      />
    );

    fireEvent.click(screen.getByText("5. Project settings"));
    fireEvent.change(screen.getByLabelText("Docker internal port"), { target: { value: "70000" } });
    expect(screen.getByText("Docker internal port must be an integer in range 1-65535.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save deploy settings" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSaveProjectRuntimeSettings).not.toHaveBeenCalled();
  });

  it("opens settings editor in fullscreen modal and allows closing", () => {
    /* Modal should open on file selection updates, not on initial stale mount. */
    const onSaveActiveFile = vi.fn();

    const baseProps = {
      activeId: "demo" as const,
      themeMode: "light" as const,
      overview: {
        globalRule: { exists: true, absolutePath: "/x/AGENTS.md" },
        projectRule: { exists: true, absolutePath: "/p/AGENTS.md" },
        projectEnv: { exists: true, absolutePath: "/p/.env" },
        projectEnvFiles: [{ name: ".env", relativePath: ".env" }],
        config: { exists: true, absolutePath: "/x/opencode.json" },
        agents: [],
        commands: []
      },
      onChangeTheme: vi.fn(),
      onRefreshProjects: vi.fn(),
      onSyncProjects: vi.fn(),
      onRestartOpenCode: vi.fn(),
      onLoadOverview: vi.fn(),
      onOpenFile: vi.fn(),
      onCreateFile: vi.fn(),
      onSaveActiveFile,
      onDeleteActiveProject: vi.fn(),
      projectRuntime: { snapshot: null, isLoading: false, isSaving: false },
      onSaveProjectRuntimeSettings: vi.fn(),
      restartOpenCodeState: { isRestarting: false as const, lastResult: "idle" as const }
    };

    const { rerender } = render(
      <SettingsTab
        {...baseProps}
        activeFile={null}
      />
    );

    expect(screen.queryByText("/home/nyx/projects/demo/.env")).toBeNull();

    rerender(
      <SettingsTab
        {...baseProps}
        activeFile={{
          kind: "projectEnvFile",
          relativePath: ".env",
          absolutePath: "/home/nyx/projects/demo/.env",
          content: "HELLO=WORLD\n",
          exists: true
        }}
      />
    );

    expect(screen.getByText("/home/nyx/projects/demo/.env")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSaveActiveFile).toHaveBeenCalledWith("HELLO=WORLD\n");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("/home/nyx/projects/demo/.env")).toBeNull();
  });

  it("hides missing AGENTS.md entries and shows only create actions", () => {
    /* Absent rule files should not look clickable in settings list. */
    render(
      <SettingsTab
        activeId="demo"
        themeMode="light"
        overview={{
          globalRule: { exists: false, absolutePath: "/x/AGENTS.md" },
          projectRule: { exists: false, absolutePath: "/p/AGENTS.md" },
          projectEnv: { exists: false, absolutePath: "/p/.env" },
          projectEnvFiles: [],
          config: { exists: true, absolutePath: "/x/opencode.json" },
          agents: [],
          commands: []
        }}
        activeFile={null}
        onChangeTheme={vi.fn()}
        onRefreshProjects={vi.fn()}
        onSyncProjects={vi.fn()}
        onRestartOpenCode={vi.fn()}
        onLoadOverview={vi.fn()}
        onOpenFile={vi.fn()}
        onCreateFile={vi.fn()}
        onSaveActiveFile={vi.fn()}
        onDeleteActiveProject={vi.fn()}
        projectRuntime={{ snapshot: null, isLoading: false, isSaving: false }}
        onSaveProjectRuntimeSettings={vi.fn()}
        restartOpenCodeState={{ isRestarting: false, lastResult: "idle" }}
      />
    );

    fireEvent.click(screen.getByText("1. Agent rules"));

    expect(screen.queryByRole("button", { name: "Global AGENTS.md" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Project AGENTS.md" })).toBeNull();
    expect(screen.getByRole("button", { name: "Create Global AGENTS.md" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create Project AGENTS.md" })).toBeTruthy();
  });

  it("does not auto-open editor on initial mount with stale activeFile", () => {
    /* Returning to Settings tab should not reopen previously edited file modal. */
    render(
      <SettingsTab
        activeId="demo"
        themeMode="light"
        overview={{
          globalRule: { exists: true, absolutePath: "/x/AGENTS.md" },
          projectRule: { exists: true, absolutePath: "/p/AGENTS.md" },
          projectEnv: { exists: true, absolutePath: "/p/.env" },
          projectEnvFiles: [{ name: ".env", relativePath: ".env" }],
          config: { exists: true, absolutePath: "/x/opencode.json" },
          agents: [],
          commands: []
        }}
        activeFile={{
          kind: "projectRule",
          absolutePath: "/home/nyx/projects/demo/AGENTS.md",
          content: "# rules",
          exists: true
        }}
        onChangeTheme={vi.fn()}
        onRefreshProjects={vi.fn()}
        onSyncProjects={vi.fn()}
        onRestartOpenCode={vi.fn()}
        onLoadOverview={vi.fn()}
        onOpenFile={vi.fn()}
        onCreateFile={vi.fn()}
        onSaveActiveFile={vi.fn()}
        onDeleteActiveProject={vi.fn()}
        projectRuntime={{ snapshot: null, isLoading: false, isSaving: false }}
        onSaveProjectRuntimeSettings={vi.fn()}
        restartOpenCodeState={{ isRestarting: false, lastResult: "idle" }}
      />
    );

    expect(screen.queryByText("/home/nyx/projects/demo/AGENTS.md")).toBeNull();
  });

  it("renders voice control accordion and saves key/model", () => {
    /* Voice settings must allow saving Groq API key and model choice from Mini App. */
    const onApiKeyChange = vi.fn();
    const onModelChange = vi.fn();
    const onSaveVoiceControl = vi.fn();

    render(
      <SettingsTab
        activeId={null}
        themeMode="light"
        overview={null}
        activeFile={null}
        onChangeTheme={vi.fn()}
        onRefreshProjects={vi.fn()}
        onSyncProjects={vi.fn()}
        onRestartOpenCode={vi.fn()}
        onLoadOverview={vi.fn()}
        onOpenFile={vi.fn()}
        onCreateFile={vi.fn()}
        onSaveActiveFile={vi.fn()}
        onDeleteActiveProject={vi.fn()}
        projectRuntime={{ snapshot: null, isLoading: false, isSaving: false }}
        onSaveProjectRuntimeSettings={vi.fn()}
        restartOpenCodeState={{ isRestarting: false, lastResult: "idle" }}
        voiceControl={{
          apiKey: "",
          model: null,
          supportedModels: ["whisper-large-v3-turbo", "whisper-large-v3"],
          isLoading: false,
          isSaving: false,
          saveResult: "idle"
        }}
        onVoiceControlApiKeyChange={onApiKeyChange}
        onVoiceControlModelChange={onModelChange}
        onSaveVoiceControl={onSaveVoiceControl}
      />
    );

    fireEvent.click(screen.getByText("6. Голосовое управление"));
    fireEvent.change(screen.getByPlaceholderText("Groq API key (gsk_...)"), {
      target: { value: "gsk_test_123" }
    });
    expect(onApiKeyChange).toHaveBeenCalledWith("gsk_test_123");

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "whisper-large-v3" }
    });
    expect(onModelChange).toHaveBeenCalledWith("whisper-large-v3");

    fireEvent.click(screen.getByRole("button", { name: "Save voice settings" }));
    expect(onSaveVoiceControl).toHaveBeenCalledTimes(1);
  });

  it("renders saving indicator for voice settings operation", () => {
    /* Save progress should be explicit so user does not guess request state. */
    render(
      <SettingsTab
        activeId={null}
        themeMode="light"
        overview={null}
        activeFile={null}
        onChangeTheme={vi.fn()}
        onRefreshProjects={vi.fn()}
        onSyncProjects={vi.fn()}
        onRestartOpenCode={vi.fn()}
        onLoadOverview={vi.fn()}
        onOpenFile={vi.fn()}
        onCreateFile={vi.fn()}
        onSaveActiveFile={vi.fn()}
        onDeleteActiveProject={vi.fn()}
        projectRuntime={{ snapshot: null, isLoading: false, isSaving: false }}
        onSaveProjectRuntimeSettings={vi.fn()}
        restartOpenCodeState={{ isRestarting: false, lastResult: "idle" }}
        voiceControl={{
          apiKey: "gsk_test_123",
          model: "whisper-large-v3",
          supportedModels: ["whisper-large-v3-turbo", "whisper-large-v3"],
          isLoading: false,
          isSaving: true,
          saveResult: "idle"
        }}
      />
    );

    fireEvent.click(screen.getByText("6. Голосовое управление"));
    expect(screen.getByText("Сохраняем настройки...")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Saving..." }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows OpenCode current/latest versions and runs update action", () => {
    /* General settings should expose actionable version state and update control. */
    const onUpdateOpenCodeVersion = vi.fn();

    render(
      <SettingsTab
        activeId={null}
        themeMode="dark"
        overview={null}
        activeFile={null}
        onChangeTheme={vi.fn()}
        onRefreshProjects={vi.fn()}
        onSyncProjects={vi.fn()}
        onRestartOpenCode={vi.fn()}
        onLoadOverview={vi.fn()}
        onOpenFile={vi.fn()}
        onCreateFile={vi.fn()}
        onSaveActiveFile={vi.fn()}
        onDeleteActiveProject={vi.fn()}
        projectRuntime={{ snapshot: null, isLoading: false, isSaving: false }}
        onSaveProjectRuntimeSettings={vi.fn()}
        restartOpenCodeState={{ isRestarting: false, lastResult: "idle" }}
        openCodeVersion={{
          status: {
            currentVersion: "1.2.3",
            latestVersion: "1.2.4",
            latestCheckedAt: "2026-02-24T12:00:00.000Z",
            updateAvailable: true
          },
          isLoading: false,
          isUpdating: false
        }}
        onUpdateOpenCodeVersion={onUpdateOpenCodeVersion}
      />
    );

    fireEvent.click(screen.getByText("7. General settings"));
    expect(screen.getByText("OpenCode: 1.2.3")).toBeTruthy();
    expect(screen.getByText("Latest: 1.2.4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Update OpenCode" }));
    expect(onUpdateOpenCodeVersion).toHaveBeenCalledTimes(1);
  });
});
