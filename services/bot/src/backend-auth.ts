/**
 * @fileoverview Shared bot->backend auth header helpers.
 *
 * Exports:
 * - ADMIN_ID_HEADER (L10) - Header carrying Telegram admin id.
 * - BOT_BACKEND_TOKEN_HEADER (L11) - Header carrying shared bot/backend secret.
 * - buildBotBackendHeaders (L13) - Builds authenticated headers for backend admin routes.
 */

import { BotConfig } from "./config";

export const ADMIN_ID_HEADER = "x-admin-id";
export const BOT_BACKEND_TOKEN_HEADER = "x-bot-backend-token";

export const buildBotBackendHeaders = (
  config: Pick<BotConfig, "botBackendAuthToken">,
  adminId: number,
  extraHeaders?: Record<string, string>
): Record<string, string> => {
  /* Centralize internal auth headers so every backend call uses the same protection. */
  return {
    ...(extraHeaders ?? {}),
    [ADMIN_ID_HEADER]: String(adminId),
    [BOT_BACKEND_TOKEN_HEADER]: config.botBackendAuthToken
  };
};
