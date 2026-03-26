/**
 * @fileoverview Integration tests for standalone diff-preview launch routing.
 *
 * Exports:
 * - none.
 */

/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MiniAppRoot } from "../MiniAppRoot";

const apiGetMock = vi.fn();
const bootstrapWebTokenFromTelegramMock = vi.fn();
const refreshWebTokenMock = vi.fn();

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");

  return {
    ...actual,
    apiGet: (...args: unknown[]) => apiGetMock(...args),
    bootstrapWebTokenFromTelegram: (...args: unknown[]) => bootstrapWebTokenFromTelegramMock(...args),
    refreshWebToken: (...args: unknown[]) => refreshWebTokenMock(...args)
  };
});

vi.mock("../App", () => ({
  App: () => <div data-testid="miniapp-workspace">workspace</div>
}));

vi.mock("../components/KanbanBoardScreen", () => ({
  KanbanBoardScreen: () => <div data-testid="miniapp-kanban-screen">kanban</div>
}));

vi.mock("../components/DiffPreviewScreen", () => ({
  DiffPreviewScreen: ({ token }: { token: string }) => <div data-testid="miniapp-diff-preview">diff preview {token}</div>
}));

const createBrowserToken = (): string => {
  /* Mini App bootstrap reads only the payload half client-side, so tests can use a lightweight signed-token stub. */
  const payload = {
    adminId: 649624756,
    iat: Date.now(),
    exp: Date.now() + 60 * 60 * 1000,
    nonce: "nonce"
  };
  const payloadBase64 = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `${payloadBase64}.signature`;
};

describe("MiniAppRoot diff preview route", () => {
  beforeEach(() => {
    /* Reset side effects so every render starts from a clean Mini App launch state. */
    apiGetMock.mockReset();
    apiGetMock.mockImplementation(async (path: string) => {
      if (path === "/api/projects/active") {
        return { id: null };
      }

      throw new Error(`Unexpected apiGet path: ${path}`);
    });
    bootstrapWebTokenFromTelegramMock.mockReset().mockResolvedValue({
      token: createBrowserToken(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    });
    refreshWebTokenMock.mockReset();
    sessionStorage.clear();
    delete (window as any).Telegram;
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    window.history.replaceState({}, "", "/miniapp/");
  });

  it("preserves diff startapp launch token while consuming browser auth token from the hash", async () => {
    /* Browser auth must stop removing the diff launch token before MiniAppRoot decides which standalone screen to render. */
    const browserToken = createBrowserToken();
    window.history.replaceState({}, "", `/miniapp/#token=${browserToken}&startapp=diff_demo-preview`);

    render(<MiniAppRoot />);

    const preview = await screen.findByTestId("miniapp-diff-preview");
    expect(preview.textContent).toContain("diff preview demo-preview");
    expect(window.location.hash).toBe("#startapp=diff_demo-preview");
    expect(sessionStorage.getItem("tvoc.miniapp.webToken")).toBe(browserToken);
  });
});
