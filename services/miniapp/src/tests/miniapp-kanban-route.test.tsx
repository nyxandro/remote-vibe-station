/**
 * @fileoverview Integration tests for standalone kanban screen routing.
 */

/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MiniAppRoot } from "../MiniAppRoot";

const apiGetMock = vi.fn();

vi.mock("../api/client", () => ({
  apiGet: (...args: unknown[]) => apiGetMock(...args)
}));

vi.mock("../App", () => ({
  App: () => <div data-testid="miniapp-workspace">workspace</div>
}));

vi.mock("../components/DiffPreviewScreen", () => ({
  DiffPreviewScreen: () => <div data-testid="miniapp-diff-preview">diff preview</div>
}));

vi.mock("../components/KanbanBoardScreen", () => ({
  KanbanBoardScreen: () => <div data-testid="miniapp-kanban-screen">kanban</div>
}));

vi.mock("../utils/start-param", () => ({
  readDiffPreviewToken: () => null
}));

describe("MiniAppRoot kanban route", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiGetMock.mockResolvedValue({ id: null });
    window.history.replaceState({}, "", "/miniapp/?view=kanban");
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it("renders standalone kanban screen when query view is kanban", async () => {
    /* Secure browser links should open the board directly instead of the regular workspace shell. */
    render(<MiniAppRoot />);

    expect(await screen.findByTestId("miniapp-kanban-screen")).toBeTruthy();
    expect(screen.queryByTestId("miniapp-workspace")).toBeNull();
  });
});
