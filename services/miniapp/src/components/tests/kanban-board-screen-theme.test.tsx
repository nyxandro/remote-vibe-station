/**
 * @fileoverview Tests for standalone kanban theme switching and persistence.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    /* Start every render from a clean theme state for deterministic assertions. */
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  it("switches theme from the standalone board and remembers the selected mode", () => {
    /* Secure board links should not force users back into Settings just to change the visual mode. */
    render(<KanbanBoardScreen initialProjectSlug={null} />);

    fireEvent.click(screen.getByRole("button", { name: /Night/i }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    fireEvent.click(screen.getByRole("button", { name: /Day/i }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });
});
