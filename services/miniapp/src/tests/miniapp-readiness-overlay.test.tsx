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
import { BROWSER_SESSION_EXPIRED_EVENT } from "../api/client";

const apiGetMock = vi.fn();
const readStoredWebTokenMetadataMock = vi.fn();
const refreshWebTokenMock = vi.fn();

vi.mock("../api/client", () => ({
  BROWSER_SESSION_EXPIRED_EVENT: "tvoc:browser-session-expired",
  apiGet: (...args: unknown[]) => apiGetMock(...args),
  clearStoredWebToken: vi.fn(),
  readStoredWebTokenMetadata: (...args: unknown[]) => readStoredWebTokenMetadataMock(...args),
  refreshWebToken: (...args: unknown[]) => refreshWebTokenMock(...args)
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
    readStoredWebTokenMetadataMock.mockReset().mockReturnValue(null);
    refreshWebTokenMock.mockReset();
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

  it("shows Telegram launch hint on missing authentication", async () => {
    /* Auth-specific backend rejection should guide user to open app from Telegram. */
    apiGetMock.mockRejectedValueOnce(new Error("Request failed: 401 - Missing authentication"));

    render(<MiniAppRoot />);

    await waitFor(() => {
      expect(
        screen.getByText(
          /Mini App требует Telegram initData\. Открой приложение из кнопки в Telegram/i
        )
      ).toBeTruthy();
    });
  });

  it("shows session-ended overlay after browser auth expiry", async () => {
    /* Expired browser-only sessions should stop rendering the workspace and tell the user to reopen from Telegram. */
    apiGetMock.mockResolvedValueOnce({ id: null });

    render(<MiniAppRoot />);

    await waitFor(() => {
      expect(screen.getByTestId("miniapp-workspace")).toBeTruthy();
    });

    window.dispatchEvent(
      new CustomEvent(BROWSER_SESSION_EXPIRED_EVENT, {
        detail: {
          message: "Сеанс завершен. Закрой Mini App и открой его заново из Telegram, чтобы получить новый токен."
        }
      })
    );

    await waitFor(() => {
      expect(screen.getByText("Сеанс завершен")).toBeTruthy();
    });
    expect(screen.getByText(/Закрой Mini App и открой его заново из Telegram/i)).toBeTruthy();
    expect(screen.queryByTestId("miniapp-workspace")).toBeNull();
  });
});
