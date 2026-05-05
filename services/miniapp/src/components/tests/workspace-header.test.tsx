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

  it("renders nine icon-only tab buttons in the expected order", () => {
    /* Top menu order should match the operator workflow from project context to settings. */
    render(
      <WorkspaceHeader
        activeProject={null}
        activeTab="projects"
        canUseProjectTabs={false}
        onSetTab={vi.fn()}
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
      "Skills",
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
        onSetTab={vi.fn()}
      />
    );

    expect(screen.queryByText("Workspace")).toBeNull();
  });

  it("keeps the Tasks tab disabled until a project is selected", () => {
    /* Kanban task board is project-scoped, so the tab must stay unavailable without active project context. */
    const { rerender } = render(
      <WorkspaceHeader
        activeProject={null}
        activeTab="projects"
        canUseProjectTabs={false}
        onSetTab={vi.fn()}
      />
    );

    expect((screen.getByRole("button", { name: "Tasks" }) as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <WorkspaceHeader
        activeProject={{
          id: "alpha",
          slug: "alpha",
          name: "Alpha",
          rootPath: "/srv/projects/alpha",
          hasCompose: true,
          configured: true,
          runnable: true,
          status: "running"
        }}
        activeTab="tasks"
        canUseProjectTabs={true}
        onSetTab={vi.fn()}
      />
    );

    expect((screen.getByRole("button", { name: "Tasks" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
