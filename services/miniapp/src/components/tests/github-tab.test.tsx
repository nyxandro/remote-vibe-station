/**
 * @fileoverview UI tests for GitHubTab git operations surface.
 *
 * Test suites:
 * - GitHubTab - Verifies git action visibility and commit interactions.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitOverview, GitHubTab } from "../GitHubTab";

const buildOverview = (): GitOverview => ({
  currentBranch: "main",
  branches: ["main", "feature/ui"],
  ahead: 1,
  behind: 0,
  files: [{ path: "src/app.ts", status: "modified", additions: 12, deletions: 4 }]
});

const buildCleanOverview = (): GitOverview => ({
  currentBranch: "main",
  branches: ["main", "feature/ui"],
  ahead: 0,
  behind: 0,
  files: []
});

describe("GitHubTab", () => {
  afterEach(() => {
    /* Keep DOM isolated between tests. */
    cleanup();
  });

  it("renders changed files list with diff stats", () => {
    /* Git tab should expose per-file status and line counters. */
    render(
      <GitHubTab
        activeId="tvoc"
        overview={buildOverview()}
        onRefresh={vi.fn()}
        onCheckout={vi.fn()}
        onCommit={vi.fn()}
        onFetch={vi.fn()}
        onPull={vi.fn()}
        onPush={vi.fn()}
        onMerge={vi.fn()}
      />
    );

    expect(screen.getByText("src/app.ts")).toBeTruthy();
    expect(screen.getByText("+12")).toBeTruthy();
    expect(screen.getByText("-4")).toBeTruthy();
  });

  it("shows current branch in selector and enables switch only for another branch", () => {
    /* Branch switch should be inert until the user picks a different target branch. */
    const onCheckout = vi.fn();
    render(
      <GitHubTab
        activeId="tvoc"
        overview={buildOverview()}
        onRefresh={vi.fn()}
        onCheckout={onCheckout}
        onCommit={vi.fn()}
        onFetch={vi.fn()}
        onPull={vi.fn()}
        onPush={vi.fn()}
        onMerge={vi.fn()}
      />
    );

    const branchSelect = screen.getByLabelText("Switch branch");
    const switchButton = screen.getByRole("button", { name: "Switch" });

    expect((branchSelect as HTMLSelectElement).value).toBe("main");
    expect((switchButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(branchSelect, { target: { value: "feature/ui" } });

    expect((switchButton as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(switchButton);

    expect(onCheckout).toHaveBeenCalledWith("feature/ui");
  });

  it("submits commit message via callback", () => {
    /* Commit action should be explicit and user-driven. */
    const onCommit = vi.fn();
    render(
      <GitHubTab
        activeId="tvoc"
        overview={buildOverview()}
        onRefresh={vi.fn()}
        onCheckout={vi.fn()}
        onCommit={onCommit}
        onFetch={vi.fn()}
        onPull={vi.fn()}
        onPush={vi.fn()}
        onMerge={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Commit message"), {
      target: { value: "feat: update git tab" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));

    expect(onCommit).toHaveBeenCalledWith("feat: update git tab");
  });

  it("hides commit controls when working tree is clean", () => {
    /* Clean repositories should not show commit UI that cannot be used. */
    render(
      <GitHubTab
        activeId="tvoc"
        overview={buildCleanOverview()}
        onRefresh={vi.fn()}
        onCheckout={vi.fn()}
        onCommit={vi.fn()}
        onFetch={vi.fn()}
        onPull={vi.fn()}
        onPush={vi.fn()}
        onMerge={vi.fn()}
      />
    );

    expect(screen.queryByText("Commit all changes")).toBeNull();
    expect(screen.queryByPlaceholderText("Commit message")).toBeNull();
    expect(screen.queryByRole("button", { name: "Commit" })).toBeNull();
    expect(screen.getByText("Working tree clean.")).toBeTruthy();
  });
});
