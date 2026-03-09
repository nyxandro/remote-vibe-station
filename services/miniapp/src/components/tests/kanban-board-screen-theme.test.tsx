/**
 * @fileoverview Tests for standalone kanban theme behavior.
 */

/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KanbanBoardScreen } from "../KanbanBoardScreen";
import { THEME_STORAGE_KEY } from "../../utils/theme";

vi.mock("../../hooks/use-kanban", () => ({
  useKanban: () => ({
    tasks: [],
    isLoading: false,
    isSaving: false,
    error: null,
    loadTasks: vi.fn(),
    reloadTasks: vi.fn(),
    createTask: vi.fn(async () => undefined),
    updateTask: vi.fn(async () => undefined),
    moveTask: vi.fn(async () => undefined)
  })
}));

vi.mock("../../hooks/use-project-catalog", () => ({
  useProjectCatalog: () => ({
    projects: [],
    isLoading: false,
    error: null,
    loadProjects: vi.fn()
  })
}));

describe("KanbanBoardScreen theme toggle", () => {
  beforeEach(() => {
    /* Mimic the globally applied theme that comes from Mini App settings before the screen mounts. */
    document.documentElement.setAttribute("data-theme", "dark");
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
  });

  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  it("inherits the global theme and does not render local day/night controls", () => {
    /* Kanban should follow the single global theme source instead of exposing a second toggle. */
    render(<KanbanBoardScreen initialProjectSlug={null} />);

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.queryByRole("button", { name: /Day/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Night/i })).toBeNull();
  });
});
