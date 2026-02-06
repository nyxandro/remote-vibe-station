/**
 * @fileoverview UI tests for GitHubTab git operations surface.
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
});
