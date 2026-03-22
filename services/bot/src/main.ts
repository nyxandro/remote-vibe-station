/**
 * @fileoverview Telegram bot bootstrap and handlers.
 *
 * Exports:
 * - bootstrap - Starts bot, outbox worker, slash sync, and transport mode.
 */

import express from "express";
import { Telegraf } from "telegraf";

import { registerAdminProjectCommands } from "./bot-admin-commands";
import {
  bindChatToTelegramStream,
  createCommandSyncRuntime
} from "./bot-command-sync-runtime";
import {
  registerBotShutdownHandlers,
  shouldAttachCookieDomain,
  startBotHttpServer
} from "./bot-http-runtime";
import { launchBotRuntime } from "./bot-launch-runtime";
import { registerBotPromptHandlers } from "./bot-prompt-handlers";
import { loadConfig } from "./config";
import { registerModeControl } from "./mode-control";
import { registerOpenCodeCallbacks } from "./opencode-callbacks";
import { registerOpenCodeAccessCommand } from "./opencode-access-command";
import { registerOpenCodeWebAuthHttp } from "./opencode-web-auth-http";
import { OpenCodeWebAuthService } from "./opencode-web-auth";
import { registerRepairCommand } from "./repair-command";
import { registerSessionCommands } from "./session-command";
import { OutboxWorker } from "./outbox-worker";
import { ThinkingIndicator } from "./thinking-indicator";

const OPENCODE_WEB_AUTH_STORAGE_FILE = "/app/data/opencode-web-auth.json";
const OPENCODE_WEB_AUTH_LINK_TTL_MS = 5 * 60 * 1000;
const OPENCODE_WEB_AUTH_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const OPENCODE_WEB_AUTH_COOKIE_NAME = "opencode_sid";

export const bootstrap = async (): Promise<void> => {
  /* Load configuration and initialize bot. */
  const config = loadConfig();
  const bot = new Telegraf(config.telegramBotToken);
  const webAuth = new OpenCodeWebAuthService({
    storageFilePath: OPENCODE_WEB_AUTH_STORAGE_FILE,
    linkTtlMs: OPENCODE_WEB_AUTH_LINK_TTL_MS,
    sessionTtlMs: OPENCODE_WEB_AUTH_SESSION_TTL_MS
  });
  const indicator = new ThinkingIndicator(bot);
  const outbox = new OutboxWorker(config, bot, indicator);
  outbox.start();
  const commandSyncRuntime = createCommandSyncRuntime({ bot, config });

  /* Helper to check admin access. */
  const isAdmin = (id: number | undefined): boolean =>
    typeof id === "number" && config.adminIds.includes(id);

  /* Register model/thinking/agent menu handlers once on bootstrap. */
  registerModeControl({ bot, config, isAdmin });

  /* Register OpenCode inline callbacks (question + permission). */
  registerOpenCodeCallbacks({ bot, config, isAdmin });

  /* Register manual stuck-session recovery command. */
  registerRepairCommand({ bot, config, isAdmin });

  /* Register session lifecycle commands and picker callbacks. */
  registerSessionCommands({ bot, config, isAdmin });

  /* Register Telegram-issued one-time links for OpenCode web UI. */
  registerOpenCodeAccessCommand({ bot, config, webAuth, isAdmin });

  /* Derive cookie domain from validated OpenCode public URL. */
  let opencodeCookieDomain: string | undefined;
  try {
    const hostname = new URL(config.opencodePublicBaseUrl).hostname;
    opencodeCookieDomain = shouldAttachCookieDomain(hostname) ? hostname : undefined;
  } catch {
    throw new Error(`Invalid OPENCODE_PUBLIC_BASE_URL: ${config.opencodePublicBaseUrl}`);
  }

  /* Always expose auth endpoints for Traefik forward-auth and link exchange. */
  const app = express();
  app.set("trust proxy", 1);
  registerOpenCodeWebAuthHttp({
    app,
    service: webAuth,
    cookieName: OPENCODE_WEB_AUTH_COOKIE_NAME,
    cookieDomain: opencodeCookieDomain
  });

  bot.catch(async (error, ctx) => {
    /* Never crash the bot on handler errors. */
    // eslint-disable-next-line no-console
    console.error("Bot handler error", error);
    try {
      await ctx.reply("Ошибка бота. Попробуй еще раз.");
    } catch {
      // ignore
    }
  });

  registerAdminProjectCommands({
    bot,
    config,
    isAdmin,
    bindChat: (adminId, chatId) => bindChatToTelegramStream(config, adminId, chatId),
    syncSlashCommands: commandSyncRuntime.syncSlashCommands
  });

  registerBotPromptHandlers({
    bot,
    config,
    indicator,
    isAdmin,
    bindChat: (adminId, chatId) => bindChatToTelegramStream(config, adminId, chatId),
    commandSyncRuntime
  });

  const { closeHttpServer } = startBotHttpServer(app);

  /* Start webhook server plus either local polling runtime or public webhook runtime. */
  await launchBotRuntime({
    app,
    bot,
    config,
    commandSyncRuntime,
    closeHttpServer,
    registerShutdownHandlers: registerBotShutdownHandlers
  });
};

void bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Bot bootstrap failed", error);
  process.exit(1);
});
