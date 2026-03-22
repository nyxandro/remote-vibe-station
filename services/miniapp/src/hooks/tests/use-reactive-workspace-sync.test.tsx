/**
 * @fileoverview Tests for centralized Mini App reactive synchronization.
 *
 * Test suites:
 * - useReactiveWorkspaceSync - Verifies tab-aware auto-refresh, focus sync, and polling rules.
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TabKey } from "../../components/WorkspaceHeader";
import { useReactiveWorkspaceSync } from "../use-reactive-workspace-sync";

type HookInput = Parameters<typeof useReactiveWorkspaceSync>[0];

const DEFAULT_VISIBILITY_STATE = Object.getOwnPropertyDescriptor(document, "visibilityState");

const setVisibilityState = (value: DocumentVisibilityState): void => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value
  });
};

const buildInput = (overrides: Partial<HookInput> = {}): HookInput => ({
  activeTab: "github",
  activeId: "alpha",
  filePath: "src",
  canControlTelegramStream: true,
  loadProjects: vi.fn().mockResolvedValue(undefined),
  loadGitOverview: vi.fn().mockResolvedValue(undefined),
  loadFiles: vi.fn().mockResolvedValue(undefined),
  loadSettingsOverview: vi.fn().mockResolvedValue(undefined),
  loadOpenCodeVersionStatus: vi.fn().mockResolvedValue(undefined),
  loadRuntime: vi.fn().mockResolvedValue(undefined),
  loadVoiceControlSettings: vi.fn().mockResolvedValue(undefined),
  loadGithubAuthStatus: vi.fn().mockResolvedValue(undefined),
  loadServerMetrics: vi.fn().mockResolvedValue(undefined),
  loadProviderOverview: vi.fn().mockResolvedValue(undefined),
  loadProxySettings: vi.fn().mockResolvedValue(undefined),
  loadCliproxyAccounts: vi.fn().mockResolvedValue(undefined),
  ...overrides
});

describe("useReactiveWorkspaceSync", () => {
  beforeEach(() => {
    /* Fake timers keep interval-driven refresh assertions deterministic. */
    vi.useFakeTimers();
    vi.clearAllMocks();
    setVisibilityState("visible");
  });

  afterEach(() => {
    /* Restore browser globals after each test to avoid leaking timing and visibility state. */
    vi.useRealTimers();
    if (DEFAULT_VISIBILITY_STATE) {
      Object.defineProperty(document, "visibilityState", DEFAULT_VISIBILITY_STATE);
    }
  });

  it("loads github overview immediately and polls it while visible", async () => {
    /* Git tab should stay fresh without relying on the manual refresh button. */
    const input = buildInput();

    renderHook(() => useReactiveWorkspaceSync(input));

    await act(async () => undefined);

    expect(input.loadGitOverview).toHaveBeenCalledTimes(1);
    expect(input.loadGitOverview).toHaveBeenCalledWith("alpha");

    await act(async () => {
      vi.advanceTimersByTime(12000);
    });

    expect(input.loadGitOverview).toHaveBeenCalledTimes(2);
  });

  it("refreshes files on focus but does not poll the explorer in background", async () => {
    /* File tree should update on user return without hammering the backend on a timer. */
    const input = buildInput({ activeTab: "files" });

    renderHook(() => useReactiveWorkspaceSync(input));

    await act(async () => undefined);

    expect(input.loadFiles).toHaveBeenCalledTimes(1);
    expect(input.loadFiles).toHaveBeenCalledWith("alpha", "src");

    await act(async () => {
      vi.advanceTimersByTime(60000);
    });
    expect(input.loadFiles).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(input.loadFiles).toHaveBeenCalledTimes(2);
  });

  it("reloads the active files folder when filePath changes inside the files tab", async () => {
    /* Folder navigation should hydrate the newly selected path immediately, not wait for focus or polling. */
    const input = buildInput({ activeTab: "files", filePath: "src" });
    const { rerender } = renderHook((props: HookInput) => useReactiveWorkspaceSync(props), {
      initialProps: input
    });

    await act(async () => undefined);

    expect(input.loadFiles).toHaveBeenCalledWith("alpha", "src");

    const nextInput = buildInput({ activeTab: "files", filePath: "src/components" });
    rerender(nextInput);

    await act(async () => undefined);

    expect(nextInput.loadFiles).toHaveBeenCalledWith("alpha", "src/components");
  });

  it("loads settings snapshot in parallel and skips voice settings when telegram control is unavailable", async () => {
    /* Settings should auto-refresh all visible diagnostics, but only fetch Telegram-specific data when allowed. */
    const input = buildInput({
      activeTab: "settings",
      activeId: null,
      canControlTelegramStream: false
    });

    renderHook(() => useReactiveWorkspaceSync(input));

    await act(async () => undefined);

    expect(input.loadSettingsOverview).toHaveBeenCalledWith(null);
    expect(input.loadOpenCodeVersionStatus).toHaveBeenCalledTimes(1);
    expect(input.loadRuntime).toHaveBeenCalledWith(null);
    expect(input.loadGithubAuthStatus).toHaveBeenCalledTimes(1);
    expect(input.loadServerMetrics).toHaveBeenCalledTimes(1);
    expect(input.loadVoiceControlSettings).not.toHaveBeenCalled();
  });

  it("does not run central sync for already-live tabs", async () => {
    /* Terminal and kanban already have their own live channels and should not get duplicate polling. */
    const tabsWithoutCentralSync: TabKey[] = ["tasks", "terminal", "containers"];

    for (const activeTab of tabsWithoutCentralSync) {
      const input = buildInput({ activeTab });

      renderHook(() => useReactiveWorkspaceSync(input));
      await act(async () => undefined);

      await act(async () => {
        vi.advanceTimersByTime(60000);
      });

      expect(input.loadProjects).not.toHaveBeenCalled();
      expect(input.loadGitOverview).not.toHaveBeenCalled();
      expect(input.loadFiles).not.toHaveBeenCalled();
      expect(input.loadSettingsOverview).not.toHaveBeenCalled();
      expect(input.loadProviderOverview).not.toHaveBeenCalled();
    }
  });

  it("pauses polling while the document is hidden and catches up when visible again", async () => {
    /* Hidden tabs should not waste requests, but returning to the app should trigger an immediate refresh. */
    const input = buildInput({ activeTab: "projects" });

    renderHook(() => useReactiveWorkspaceSync(input));

    await act(async () => undefined);

    expect(input.loadProjects).toHaveBeenCalledTimes(1);

    setVisibilityState("hidden");
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });
    expect(input.loadProjects).toHaveBeenCalledTimes(1);

    setVisibilityState("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(input.loadProjects).toHaveBeenCalledTimes(2);
  });
});
