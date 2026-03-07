/**
 * @fileoverview Telegram menu button helpers for Mini App entrypoint.
 *
 * Exports:
 * - TelegramMenuButtonApi - Minimal Telegram API wrapper needed for menu-button sync.
 * - buildMiniAppMenuButton - Builds web_app or commands fallback button payload.
 * - syncMiniAppMenuButton - Pushes the menu button configuration to Telegram.
 */

export type TelegramMenuButtonApi = {
  setChatMenuButton: (input: {
    menuButton:
      | { type: "commands" }
      | { type: "web_app"; text: string; web_app: { url: string } };
  }) => Promise<unknown>;
};

const MINIAPP_MENU_BUTTON_TEXT = "Panel";

export const buildMiniAppMenuButton = (publicBaseUrl: string):
  | { type: "commands" }
  | { type: "web_app"; text: string; web_app: { url: string } } => {
  /* Telegram WebApp menu button is valid only for secure public Mini App URL. */
  if (!publicBaseUrl.startsWith("https://")) {
    return { type: "commands" };
  }

  const url = new URL("/miniapp", publicBaseUrl).toString();
  return {
    type: "web_app",
    text: MINIAPP_MENU_BUTTON_TEXT,
    web_app: { url }
  };
};

export const syncMiniAppMenuButton = async (
  telegram: TelegramMenuButtonApi,
  publicBaseUrl: string
): Promise<void> => {
  /* Keep one canonical menu button state so users open Mini App from Telegram menu, not slash command. */
  await telegram.setChatMenuButton({
    menuButton: buildMiniAppMenuButton(publicBaseUrl)
  });
};
