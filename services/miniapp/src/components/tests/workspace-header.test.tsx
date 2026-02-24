/**
 * @fileoverview UI tests for icon-only top navigation in WorkspaceHeader.
 */

/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceHeader } from "../WorkspaceHeader";

describe("WorkspaceHeader", () => {
  afterEach(() => {
    /* Keep each test independent and role queries deterministic. */
    cleanup();
  });

  it("renders seven icon-only tab buttons", () => {
    /* Top menu should expose full icon navigation including Providers tab. */
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

    expect(screen.getByRole("button", { name: "Projects" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Files" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Providers" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "GitHub" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Terminal" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Containers" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
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
