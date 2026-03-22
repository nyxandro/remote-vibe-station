/**
 * @fileoverview Tests for workspace runtime action hook.
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiPost } from "../../api/client";
import { useWorkspaceRuntimeActions } from "../use-workspace-runtime-actions";

vi.mock("../../api/client", () => ({
  apiPost: vi.fn()
}));

describe("useWorkspaceRuntimeActions", () => {
  beforeEach(() => {
    /* Keep per-test request history isolated so assertions stay tied to one action flow. */
    vi.clearAllMocks();
  });

  it("does not send terminal input when the draft is blank", async () => {
    /* Empty drafts should be ignored so the backend never receives meaningless newline-only input. */
    const setTerminalInput = vi.fn();

    const { result } = renderHook(() =>
      useWorkspaceRuntimeActions({
        setError: vi.fn(),
        terminalInput: "   ",
        setTerminalInput,
        loadProjects: vi.fn(),
        loadStatus: vi.fn()
      })
    );

    await act(async () => {
      await result.current.sendTerminal("alpha");
    });

    expect(apiPost).not.toHaveBeenCalled();
    expect(setTerminalInput).not.toHaveBeenCalled();
  });

  it("reloads project catalog and status after a lifecycle action", async () => {
    /* Start/stop/restart must refresh both cards and the selected project container state. */
    vi.mocked(apiPost).mockResolvedValue({});
    const loadProjects = vi.fn().mockResolvedValue(undefined);
    const loadStatus = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useWorkspaceRuntimeActions({
        setError: vi.fn(),
        terminalInput: "pwd",
        setTerminalInput: vi.fn(),
        loadProjects,
        loadStatus
      })
    );

    await act(async () => {
      await result.current.runAction("alpha", "restart");
    });

    expect(apiPost).toHaveBeenCalledWith("/api/projects/alpha/restart", {});
    expect(loadProjects).toHaveBeenCalledTimes(1);
    expect(loadStatus).toHaveBeenCalledWith("alpha");
  });

  it("trims terminal input, encodes project path, and clears draft only after success", async () => {
    /* Command submission should preserve the draft on failure and send a normalized payload on success. */
    vi.mocked(apiPost).mockResolvedValueOnce({});
    const setTerminalInput = vi.fn();

    const { result } = renderHook(() =>
      useWorkspaceRuntimeActions({
        setError: vi.fn(),
        terminalInput: "  pwd  ",
        setTerminalInput,
        loadProjects: vi.fn(),
        loadStatus: vi.fn()
      })
    );

    await act(async () => {
      await result.current.sendTerminal("alpha/beta");
    });

    expect(apiPost).toHaveBeenCalledWith("/api/projects/alpha%2Fbeta/terminal/input", { input: "pwd\n" });
    expect(setTerminalInput).toHaveBeenCalledWith("");
  });
});
