/**
 * @fileoverview Tests for project git action hook invalidation behavior.
 *
 * Test suites:
 * - useProjectGit - Verifies git mutations refresh both local overview and project catalog invalidation.
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet, apiPost } from "../../api/client";
import { useProjectGit } from "../use-project-git";

vi.mock("../../api/client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn()
}));

const buildOverview = () => ({
  currentBranch: "main",
  branches: ["main", "feature/ui"],
  ahead: 1,
  behind: 0,
  files: [{ path: "src/app.ts", status: "modified" as const, additions: 5, deletions: 1 }]
});

describe("useProjectGit", () => {
  beforeEach(() => {
    /* Reset API mocks so each test observes a single git mutation flow. */
    vi.clearAllMocks();
  });

  it("invalidates the project catalog after a successful commit", async () => {
    /* Commit success should refresh cross-tab git summary, not just the GitHub tab snapshot. */
    vi.mocked(apiPost).mockResolvedValueOnce(buildOverview());
    const invalidateProjectCatalog = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectGit(vi.fn(), invalidateProjectCatalog));

    await act(async () => {
      await result.current.commitAll("alpha", "feat: sync status");
    });

    expect(apiPost).toHaveBeenCalledWith("/api/projects/alpha/git/commit", { message: "feat: sync status" });
    expect(result.current.gitOverviewMap.alpha?.currentBranch).toBe("main");
    expect(invalidateProjectCatalog).toHaveBeenCalledWith("alpha");
  });

  it("invalidates the project catalog after a successful branch checkout", async () => {
    /* Branch switch should immediately update Projects cards that show current branch metadata. */
    vi.mocked(apiPost).mockResolvedValueOnce({
      ...buildOverview(),
      currentBranch: "feature/ui"
    });
    const invalidateProjectCatalog = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectGit(vi.fn(), invalidateProjectCatalog));

    await act(async () => {
      await result.current.checkoutBranch("alpha", "feature/ui");
    });

    expect(apiPost).toHaveBeenCalledWith("/api/projects/alpha/git/checkout", { branch: "feature/ui" });
    expect(result.current.gitOverviewMap.alpha?.currentBranch).toBe("feature/ui");
    expect(invalidateProjectCatalog).toHaveBeenCalledWith("alpha");
  });

  it("still loads git overview without invalidating the project catalog", async () => {
    /* Passive overview refresh should not fan out into unrelated project-card reloads. */
    vi.mocked(apiGet).mockResolvedValueOnce(buildOverview());
    const invalidateProjectCatalog = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectGit(vi.fn(), invalidateProjectCatalog));

    await act(async () => {
      await result.current.loadGitOverview("alpha");
    });

    expect(apiGet).toHaveBeenCalledWith("/api/projects/alpha/git/overview");
    expect(invalidateProjectCatalog).not.toHaveBeenCalled();
  });
});
