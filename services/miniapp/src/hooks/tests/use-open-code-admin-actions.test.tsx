/**
 * @fileoverview Tests for OpenCode admin action orchestration hook.
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiPost } from "../../api/client";
import { useOpenCodeAdminActions } from "../use-open-code-admin-actions";

vi.mock("../../api/client", () => ({
  apiPost: vi.fn()
}));

describe("useOpenCodeAdminActions", () => {
  beforeEach(() => {
    /* Keep each test isolated from previous request history and restart status transitions. */
    vi.clearAllMocks();
  });

  it("swallows startup sync failures without surfacing a blocking error", async () => {
    /* Initial sync is best-effort and must not break workspace boot if the backend is still warming up. */
    vi.mocked(apiPost).mockRejectedValueOnce(new Error("warming up"));
    const setError = vi.fn();

    const { result } = renderHook(() =>
      useOpenCodeAdminActions({
        setError,
        activeId: null,
        loadProjects: vi.fn(),
        loadSettingsOverview: vi.fn(),
        checkOpenCodeVersionStatus: vi.fn()
      })
    );

    await act(async () => {
      await result.current.syncOpenCodeAtStartup();
    });

    expect(setError).not.toHaveBeenCalledWith("warming up");
  });

  it("tracks restart state and reloads settings after a successful restart", async () => {
    /* Restart action should expose deterministic success state so Settings UI can render operator feedback. */
    vi.mocked(apiPost).mockResolvedValueOnce({});
    const loadSettingsOverview = vi.fn().mockResolvedValue(undefined);
    const refreshSettingsSurface = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useOpenCodeAdminActions({
        setError: vi.fn(),
        activeId: "alpha",
        loadProjects: vi.fn(),
        loadSettingsOverview,
        checkOpenCodeVersionStatus: vi.fn(),
        refreshSettingsSurface
      })
    );

    await act(async () => {
      await result.current.restartOpenCodeNow();
    });

    expect(apiPost).toHaveBeenCalledWith("/api/opencode/restart", {});
    expect(refreshSettingsSurface).toHaveBeenCalledWith("alpha");
    expect(loadSettingsOverview).not.toHaveBeenCalled();
    expect(result.current.restartOpenCodeState.lastResult).toBe("success");
  });

  it("uses the full settings refresh helper for manual reload", async () => {
    /* Manual reload should refresh the whole Settings screen, not just config overview and version status. */
    const refreshSettingsSurface = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useOpenCodeAdminActions({
        setError: vi.fn(),
        activeId: "alpha",
        loadProjects: vi.fn(),
        loadSettingsOverview: vi.fn(),
        checkOpenCodeVersionStatus: vi.fn(),
        refreshSettingsSurface
      })
    );

    await act(async () => {
      await result.current.reloadSettingsNow();
    });

    expect(refreshSettingsSurface).toHaveBeenCalledWith("alpha");
  });

  it("surfaces reload errors when settings refresh fails", async () => {
    /* Manual reload should report backend/config refresh failures instead of failing silently. */
    const setError = vi.fn();

    const { result } = renderHook(() =>
      useOpenCodeAdminActions({
        setError,
        activeId: "alpha",
        loadProjects: vi.fn(),
        loadSettingsOverview: vi.fn().mockRejectedValue(new Error("reload failed")),
        checkOpenCodeVersionStatus: vi.fn().mockResolvedValue(undefined),
        refreshSettingsSurface: vi.fn().mockRejectedValue(new Error("reload failed"))
      })
    );

    await act(async () => {
      await result.current.reloadSettingsNow();
    });

    expect(setError).toHaveBeenCalledWith("reload failed");
  });
});
