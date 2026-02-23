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
    /* Project list refresh is intentionally moved from Projects tab to Settings tab. */
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
        restartOpenCodeState={{ isRestarting: false, lastResult: "idle" }}
      />
    );

    fireEvent.click(screen.getByText("7. General settings"));
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
        restartOpenCodeState={{ isRestarting: false, lastResult: "idle" }}
        voiceControl={{
          apiKey: "",
          model: null,
          supportedModels: ["whisper-large-v3-turbo", "whisper-large-v3"],
          isLoading: false,
          isSaving: false
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
});
