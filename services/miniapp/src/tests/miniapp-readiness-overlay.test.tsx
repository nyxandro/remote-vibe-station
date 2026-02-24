/**
 * @fileoverview Integration tests for Mini App blocking overlay.
 *
 * Exports:
 * - (none)
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MiniAppRoot } from "../MiniAppRoot";

const apiGetMock = vi.fn();

vi.mock("../api/client", () => ({
  apiGet: (...args: unknown[]) => apiGetMock(...args)
}));

vi.mock("../App", () => ({
  App: () => <div data-testid="miniapp-workspace">workspace ready</div>
}));

vi.mock("../components/DiffPreviewScreen", () => ({
  DiffPreviewScreen: () => <div data-testid="miniapp-diff-preview">diff preview</div>
}));

vi.mock("../utils/start-param", () => ({
  readDiffPreviewToken: () => null
}));

describe("MiniAppRoot readiness overlay", () => {
  beforeEach(() => {
    apiGetMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("blocks UI when backend is unavailable and unlocks after manual retry", async () => {
    /* First probe fails, second probe succeeds after pressing retry. */
    apiGetMock
      .mockRejectedValueOnce(new Error("Request failed: 500 - fetch failed"))
      .mockResolvedValueOnce({ id: null });

    render(<MiniAppRoot />);

    await waitFor(() => {
      expect(screen.getByText("Mini App временно недоступен")).toBeTruthy();
    });
    expect(screen.queryByTestId("miniapp-workspace")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Повторить сейчас" }));

    await waitFor(() => {
      expect(screen.getByTestId("miniapp-workspace")).toBeTruthy();
    });
    expect(screen.queryByText("Mini App временно недоступен")).toBeNull();
  });
});
