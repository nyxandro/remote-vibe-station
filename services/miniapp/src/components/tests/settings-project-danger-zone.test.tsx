/**
 * @fileoverview Tests for project deletion confirmation flow in Settings tab.
 *
 * Exports:
 * - none (Vitest suite).
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsProjectDangerZone } from "../SettingsProjectDangerZone";

describe("SettingsProjectDangerZone", () => {
  afterEach(() => {
    /* Keep modal role queries deterministic between test cases. */
    cleanup();
  });

  it("opens a confirmation modal before deleting the selected local project", async () => {
    /* Project folder deletion is destructive and should require one explicit in-app confirmation step. */
    const onDeleteActiveProject = vi.fn(async () => undefined);

    render(
      <SettingsProjectDangerZone activeProjectId="demo-project" onDeleteActiveProject={onDeleteActiveProject} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete selected local project" }));

    expect(onDeleteActiveProject).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Удалить локальный проект?" })).toBeTruthy();
    expect(screen.getByText("demo-project")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Удалить проект" }));

    await waitFor(() => {
      expect(onDeleteActiveProject).toHaveBeenCalledTimes(1);
    });
  });

  it("closes the confirmation modal without deleting when the operator cancels", () => {
    /* Safe cancellation should leave the project untouched and simply hide the danger prompt. */
    const onDeleteActiveProject = vi.fn(async () => undefined);

    render(
      <SettingsProjectDangerZone activeProjectId="demo-project" onDeleteActiveProject={onDeleteActiveProject} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete selected local project" }));
    fireEvent.click(screen.getByRole("button", { name: "Оставить проект" }));

    expect(screen.queryByRole("dialog", { name: "Удалить локальный проект?" })).toBeNull();
    expect(onDeleteActiveProject).not.toHaveBeenCalled();
  });
});
