/**
 * @fileoverview Transport-mode bootstrap helpers for local polling and public webhook bot runtimes.
 *
 * Exports:
 * - BotLaunchCommandSyncRuntime - Minimal command sync runtime needed during transport boot.
 * - BotLaunchDependencies - External side effects injected for testable runtime launch.
 * - isLocalBotRuntime - Detects localhost polling mode from public base URL.
 * - resolvePrimaryAdminId - Picks the first admin id used for startup sync/warmup.
 * - launchBotRuntime - Boots the bot in polling or webhook mode and wires shutdown handlers.
 */

import { Express } from "express";
import { Telegraf } from "telegraf";

import { BotConfig } from "./config";
import { checkOpenCodeVersionOnBoot } from "./bot-command-sync-runtime";
import { registerBotShutdownHandlers } from "./bot-http-runtime";
import { syncMiniAppMenuButton } from "./miniapp-menu-button";
import { createTelegramWebhookMiddleware } from "./telegram-webhook-http";

export type BotLaunchCommandSyncRuntime = {
  syncSlashCommands: (adminId: number) => Promise<void>;
  startPeriodicCommandSync: (adminId: number) => void;
  stopPeriodicCommandSync: () => void;
};

export type BotLaunchDependencies = {
  syncMiniAppMenuButton: typeof syncMiniAppMenuButton;
  checkOpenCodeVersionOnBoot: typeof checkOpenCodeVersionOnBoot;
  registerShutdownHandlers: typeof registerBotShutdownHandlers;
};

const DEFAULT_DEPENDENCIES: BotLaunchDependencies = {
  syncMiniAppMenuButton,
  checkOpenCodeVersionOnBoot,
  registerShutdownHandlers: registerBotShutdownHandlers
};

export const isLocalBotRuntime = (publicBaseUrl: string): boolean => {
  /* Local dev uses polling so Telegram does not require a public HTTPS webhook endpoint. */
  return publicBaseUrl.startsWith("http://localhost") || publicBaseUrl.startsWith("http://127.0.0.1");
};

export const resolvePrimaryAdminId = (adminIds: number[]): number | null => {
  /* Startup sync/warmup uses the first configured admin because those endpoints are admin-scoped. */
  return Array.isArray(adminIds) && typeof adminIds[0] === "number" ? adminIds[0] : null;
};

export const launchBotRuntime = async (input: {
  app: Express;
  bot: Telegraf;
  config: BotConfig;
  commandSyncRuntime: BotLaunchCommandSyncRuntime;
  closeHttpServer: () => Promise<void>;
  syncMiniAppMenuButton?: typeof syncMiniAppMenuButton;
  checkOpenCodeVersionOnBoot?: typeof checkOpenCodeVersionOnBoot;
  registerShutdownHandlers?: typeof registerBotShutdownHandlers;
}): Promise<void> => {
  /* Shared boot path keeps polling and webhook startup behavior consistent and testable. */
  const dependencies: BotLaunchDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...(input.syncMiniAppMenuButton ? { syncMiniAppMenuButton: input.syncMiniAppMenuButton } : {}),
    ...(input.checkOpenCodeVersionOnBoot ? { checkOpenCodeVersionOnBoot: input.checkOpenCodeVersionOnBoot } : {}),
    ...(input.registerShutdownHandlers ? { registerShutdownHandlers: input.registerShutdownHandlers } : {})
  };
  const localRuntime = isLocalBotRuntime(input.config.publicBaseUrl);
  const primaryAdminId = resolvePrimaryAdminId(input.config.adminIds);

  if (localRuntime) {
    /* Polling mode still needs menu sync and warmup so operator UX matches webhook deployments. */
    await dependencies.syncMiniAppMenuButton(input.bot.telegram, input.config.publicBaseUrl);

    if (primaryAdminId !== null) {
      try {
        await input.commandSyncRuntime.syncSlashCommands(primaryAdminId);
      } catch (error) {
        /* Startup sync remains best-effort so polling mode still boots when backend catalog lags. */
        // eslint-disable-next-line no-console
        console.warn(`syncSlashCommands failed during polling boot for admin ${primaryAdminId}`, error);
      }

      await dependencies.checkOpenCodeVersionOnBoot(input.config, primaryAdminId);
      input.commandSyncRuntime.startPeriodicCommandSync(primaryAdminId);
    }

    await input.bot.launch();
    dependencies.registerShutdownHandlers({
      stopPeriodicCommandSync: input.commandSyncRuntime.stopPeriodicCommandSync,
      stopBot: (signal) => input.bot.stop(signal),
      closeHttpServer: input.closeHttpServer
    });
    return;
  }

  if (primaryAdminId !== null) {
    try {
      /* Webhook boot must survive backend/OpenCode warmup races that happen during runtime restarts. */
      await dependencies.checkOpenCodeVersionOnBoot(input.config, primaryAdminId);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn("OpenCode version warmup failed during webhook boot; continuing startup", error);
    }
  }

  /* Public HTTPS mode exposes Telegram webhook over Express and keeps menu button in sync. */
  input.app.use("/bot/webhook", createTelegramWebhookMiddleware(input.bot));
  await input.bot.telegram.setWebhook(`${input.config.publicBaseUrl}/bot/webhook`);
  await dependencies.syncMiniAppMenuButton(input.bot.telegram, input.config.publicBaseUrl);

  if (primaryAdminId !== null) {
    try {
      await input.commandSyncRuntime.syncSlashCommands(primaryAdminId);
    } catch (error) {
      /* Webhook boot stays resilient to temporary command-catalog lag. */
      // eslint-disable-next-line no-console
      console.warn(`syncSlashCommands failed during webhook boot for admin ${primaryAdminId}`, error);
    }

    input.commandSyncRuntime.startPeriodicCommandSync(primaryAdminId);
  }

  dependencies.registerShutdownHandlers({
    stopPeriodicCommandSync: input.commandSyncRuntime.stopPeriodicCommandSync,
    stopBot: (signal) => input.bot.stop(signal),
    closeHttpServer: input.closeHttpServer
  });
};
