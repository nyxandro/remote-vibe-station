/**
 * @fileoverview UI tests for icon-only top navigation in WorkspaceHeader.
 */

/* @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceHeader } from "../WorkspaceHeader";

describe("WorkspaceHeader", () => {
  afterEach(() => {
    /* Keep each test independent and role queries deterministic. */
    cleanup();
  });

  it("renders eight icon-only tab buttons in the expected order", () => {
    /* Top menu order should match the operator workflow from project context to settings. */
    render(
      <WorkspaceHeader
        activeProject={null}
        activeTab="projects"
        canUseProjectTabs={false}
        canControlTelegramStream={false}
        telegramStreamEnabled={false}
        onSetTab={vi.fn()}
        onStartStream={vi.fn()}
        onStopStream={vi.fn()}
      />
    );

    const navigation = screen.getByRole("navigation", { name: "Workspace navigation" });
    const labels = within(navigation)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));

    expect(labels).toEqual([
      "Projects",
      "Files",
      "GitHub",
      "Tasks",
      "Containers",
      "Providers",
      "Terminal",
      "Settings"
    ]);

    expect(screen.queryByRole("button", { name: "CLI/Proxy" })).toBeNull();
  });

  it("does not render legacy workspace title text", () => {
    /* Header no longer uses textual Workspace title line. */
    render(
      <WorkspaceHeader
        activeProject={null}
        activeTab="projects"
        canUseProjectTabs={false}
        canControlTelegramStream={false}
        telegramStreamEnabled={false}
        onSetTab={vi.fn()}
        onStartStream={vi.fn()}
        onStopStream={vi.fn()}
      />
    );

    expect(screen.queryByText("Workspace")).toBeNull();
  });
});
