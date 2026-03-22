/**
 * @fileoverview Tests for workspace live event hook.
 *
 * Test suites:
 * - useWorkspaceEvents - Verifies workspace websocket events trigger the right Mini App surface reloads.
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getEventStreamUrl } from "../../api/client";
import { TabKey } from "../../components/WorkspaceHeader";
import { useWorkspaceEvents } from "../use-workspace-events";

vi.mock("../../api/client", () => ({
  getEventStreamUrl: vi.fn()
}));

type MockSocketInstance = {
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
};

class MockWebSocket {
  public static instances: MockSocketInstance[] = [];

  public onmessage: ((event: { data: string }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public close = vi.fn();

  public constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }
}

type HookInput = Parameters<typeof useWorkspaceEvents>[0];

const buildInput = (overrides: Partial<HookInput> = {}): HookInput => ({
  activeTab: "github",
  activeId: "alpha",
  filePath: "src",
  onProjectsChanged: vi.fn(),
  onGitChanged: vi.fn(),
  onFilesChanged: vi.fn(),
  onSettingsChanged: vi.fn(),
  onProvidersChanged: vi.fn(),
  ...overrides
});

describe("useWorkspaceEvents", () => {
  beforeEach(() => {
    /* Reset socket state between tests so each scenario observes exactly one event flow. */
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
    vi.mocked(getEventStreamUrl).mockResolvedValue("ws://example.test/events?token=workspace");
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    /* Restore globals so other hook suites do not inherit the workspace socket double. */
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("refreshes the projects surface for matching workspace events", async () => {
    /* Project list and card metadata should react to live workspace invalidations without button clicks. */
    const input = buildInput({ activeTab: "projects", activeId: null });
    renderHook(() => useWorkspaceEvents(input));

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      MockWebSocket.instances[0]?.onmessage?.({
        data: JSON.stringify({
          type: "workspace.state.changed",
          data: { projectSlug: null, surfaces: ["projects"], reason: "projects.sync" }
        })
      });
      vi.advanceTimersByTime(250);
    });

    expect(input.onProjectsChanged).toHaveBeenCalledTimes(1);
  });

  it("refreshes git only for the currently active project", async () => {
    /* Cross-project git events must not reload the wrong GitHub tab. */
    const input = buildInput({ activeTab: "github", activeId: "alpha" });
    renderHook(() => useWorkspaceEvents(input));

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      MockWebSocket.instances[0]?.onmessage?.({
        data: JSON.stringify({
          type: "workspace.state.changed",
          data: { projectSlug: "beta", surfaces: ["git"], reason: "git.commit" }
        })
      });
      MockWebSocket.instances[0]?.onmessage?.({
        data: JSON.stringify({
          type: "workspace.state.changed",
          data: { projectSlug: "alpha", surfaces: ["git"], reason: "git.commit" }
        })
      });
      vi.advanceTimersByTime(250);
    });

    expect(input.onGitChanged).toHaveBeenCalledTimes(1);
    expect(input.onGitChanged).toHaveBeenCalledWith("alpha");
  });

  it("uses the latest filePath when a files event arrives after navigation", async () => {
    /* Live file invalidation must refresh the folder the user is currently browsing, not the old path. */
    const initialInput = buildInput({ activeTab: "files", activeId: "alpha", filePath: "src" });
    const { rerender } = renderHook((props: HookInput) => useWorkspaceEvents(props), {
      initialProps: initialInput
    });

    await act(async () => {
      await Promise.resolve();
    });

    const nextInput = buildInput({ activeTab: "files", activeId: "alpha", filePath: "src/components" });
    rerender(nextInput);

    act(() => {
      MockWebSocket.instances[0]?.onmessage?.({
        data: JSON.stringify({
          type: "workspace.state.changed",
          data: { projectSlug: "alpha", surfaces: ["files"], reason: "files.upload" }
        })
      });
      vi.advanceTimersByTime(250);
    });

    expect(nextInput.onFilesChanged).toHaveBeenCalledWith("alpha", "src/components");
  });
});
