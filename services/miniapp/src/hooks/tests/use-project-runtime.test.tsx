/**
 * @fileoverview Tests for project runtime hook stability and behavior.
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useProjectRuntime } from "../use-project-runtime";

vi.mock("../../api/client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn()
}));

describe("useProjectRuntime", () => {
  it("keeps loadRuntime callback stable across rerenders", () => {
    /*
     * Stable callback identity is required to avoid effect dependency loops
     * in Settings view where loadRuntime is part of useEffect deps.
     */
    const setError = vi.fn();
    const refreshProjects = vi.fn().mockResolvedValue(undefined);

    const { result, rerender } = renderHook(() => useProjectRuntime(setError, refreshProjects));
    const firstLoadRuntime = result.current.loadRuntime;

    rerender();

    expect(result.current.loadRuntime).toBe(firstLoadRuntime);
  });

  it("clears runtime when project becomes null", async () => {
    /*
     * When no project is selected, hook must clear stale runtime snapshot
     * immediately to prevent showing previous project deploy state.
     */
    const setError = vi.fn();
    const refreshProjects = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectRuntime(setError, refreshProjects));

    await act(async () => {
      await result.current.loadRuntime(null);
    });

    expect(result.current.runtime).toBeNull();
    expect(result.current.isRuntimeLoading).toBe(false);
  });
});
