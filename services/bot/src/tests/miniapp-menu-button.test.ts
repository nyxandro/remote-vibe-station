/**
 * @fileoverview Tests for Telegram Mini App menu button setup.
 */

import { buildMiniAppMenuButton, syncMiniAppMenuButton } from "../miniapp-menu-button";

describe("miniapp-menu-button", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test("builds web app menu button for secure Mini App URL", () => {
    /* Telegram should expose Mini App from the menu button only for HTTPS deployments. */
    expect(buildMiniAppMenuButton("https://example.com")).toEqual({
      type: "web_app",
      text: "Open Mini App",
      web_app: { url: "https://example.com/miniapp" }
    });
  });

  test("falls back to commands menu button for non-https URL", () => {
    /* Local or insecure deployments cannot publish Telegram WebApp menu button. */
    expect(buildMiniAppMenuButton("http://localhost:4173")).toEqual({ type: "commands" });
  });

  test("syncs menu button through Telegram API wrapper", async () => {
    /* Bootstrap should push the persistent Mini App button without requiring /open command. */
    const telegram = {
      setChatMenuButton: jest.fn().mockResolvedValue(true)
    };

    await syncMiniAppMenuButton(telegram as never, "https://example.com");

    expect(telegram.setChatMenuButton).toHaveBeenCalledWith({
      menuButton: {
        type: "web_app",
        text: "Open Mini App",
        web_app: { url: "https://example.com/miniapp" }
      }
    });
  });
});
