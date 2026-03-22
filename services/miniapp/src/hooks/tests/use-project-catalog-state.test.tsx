/**
 * @fileoverview Tests for workspace project catalog state hook.
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet } from "../../api/client";
import { loadProjectMetadata } from "../../utils/project-metadata";
import { useProjectCatalogState } from "../use-project-catalog-state";

vi.mock("../../api/client", () => ({
  apiGet: vi.fn()
}));

vi.mock("../../utils/project-metadata", () => ({
  loadProjectMetadata: vi.fn()
}));

const alphaProject = {
  id: "alpha",
  slug: "alpha",
  name: "Alpha",
  rootPath: "/srv/projects/alpha",
  hasCompose: true,
  configured: true,
  runnable: true,
  status: "running" as const
};

const betaProject = {
  id: "beta",
  slug: "beta",
  name: "Beta",
  rootPath: "/srv/projects/beta",
  hasCompose: true,
  configured: true,
  runnable: true,
  status: "stopped" as const
};

describe("useProjectCatalogState", () => {
  beforeEach(() => {
    /* Reset module mocks so each test controls both catalog and metadata request ordering. */
    vi.clearAllMocks();
  });

  it("loads projects together with status and git summary metadata", async () => {
    /* Workspace cards should expose catalog rows and best-effort metadata after one refresh action. */
    vi.mocked(apiGet).mockResolvedValueOnce([alphaProject]);
    vi.mocked(loadProjectMetadata).mockResolvedValueOnce({
      statusMap: { alpha: [{ name: "alpha-web", service: "web", state: "running" }] },
      gitSummaryMap: { alpha: { filesChanged: 2, additions: 5, deletions: 1 } }
    });

    const setError = vi.fn();
    const { result } = renderHook(() => useProjectCatalogState(setError));

    await act(async () => {
      await result.current.loadProjects();
      await Promise.resolve();
    });

    expect(result.current.projects).toEqual([alphaProject]);
    expect(result.current.statusMap.alpha?.[0]?.service).toBe("web");
    expect(result.current.gitSummaryMap.alpha?.filesChanged).toBe(2);
    expect(setError).toHaveBeenCalledWith(null);
  });

  it("ignores stale metadata when a newer project refresh has already completed", async () => {
    /* Late metadata from an older refresh must not overwrite the current project list cards. */
    let resolveFirstMetadata: ((value: { statusMap: Record<string, unknown>; gitSummaryMap: Record<string, unknown> }) => void) | null = null;
    const firstMetadata = new Promise<{ statusMap: Record<string, unknown>; gitSummaryMap: Record<string, unknown> }>(
      (resolve) => {
        resolveFirstMetadata = resolve;
      }
    );

    vi.mocked(apiGet).mockResolvedValueOnce([alphaProject]).mockResolvedValueOnce([betaProject]);
    vi.mocked(loadProjectMetadata)
      .mockReturnValueOnce(firstMetadata as Promise<any>)
      .mockResolvedValueOnce({
        statusMap: { beta: [{ name: "beta-web", service: "web", state: "running" }] },
        gitSummaryMap: { beta: { filesChanged: 1, additions: 9, deletions: 0 } }
      });

    const { result } = renderHook(() => useProjectCatalogState(vi.fn()));

    await act(async () => {
      await result.current.loadProjects();
      await result.current.loadProjects();
      await Promise.resolve();
    });

    expect(result.current.projects).toEqual([betaProject]);
    expect(result.current.statusMap.beta?.[0]?.name).toBe("beta-web");
    expect(result.current.gitSummaryMap.beta?.filesChanged).toBe(1);

    await act(async () => {
      resolveFirstMetadata?.({
        statusMap: { alpha: [{ name: "alpha-web", service: "web", state: "exited" }] },
        gitSummaryMap: { alpha: { filesChanged: 99, additions: 99, deletions: 99 } }
      });
      await Promise.resolve();
    });

    expect(result.current.projects).toEqual([betaProject]);
    expect(result.current.statusMap.alpha).toBeUndefined();
    expect(result.current.gitSummaryMap.alpha).toBeUndefined();
  });

  it("ignores stale status reload for the same project when a newer request finishes first", async () => {
    /* Repeated status refreshes must not let a slower stale response overwrite fresher container state. */
    let resolveFirstStatus: ((value: unknown) => void) | null = null;
    const firstStatus = new Promise((resolve) => {
      resolveFirstStatus = resolve;
    });

    vi.mocked(apiGet)
      .mockReturnValueOnce(firstStatus as Promise<any>)
      .mockResolvedValueOnce([{ name: "alpha-web", service: "web", state: "running" }]);

    const { result } = renderHook(() => useProjectCatalogState(vi.fn()));

    let firstRequest: Promise<void> | null = null;
    await act(async () => {
      firstRequest = result.current.loadStatus("alpha");
      await result.current.loadStatus("alpha");
    });

    expect(result.current.statusMap.alpha?.[0]?.state).toBe("running");

    await act(async () => {
      resolveFirstStatus?.([{ name: "alpha-web", service: "web", state: "exited" }]);
      await firstRequest;
    });

    expect(result.current.statusMap.alpha?.[0]?.state).toBe("running");
  });
});
