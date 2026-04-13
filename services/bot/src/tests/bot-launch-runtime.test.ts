/**
 * @fileoverview Tests for bot launch runtime orchestration.
 */

import { Telegraf } from "telegraf";

import { launchBotRuntime } from "../bot-launch-runtime";
import { BotConfig } from "../config";

describe("launchBotRuntime", () => {
  const baseConfig: BotConfig = {
    telegramBotToken: "token",
    adminIds: [1],
    backendUrl: "http://backend:3000",
    botBackendAuthToken: "secret-token",
    publicBaseUrl: "http://localhost:4173",
    opencodePublicBaseUrl: "http://localhost:4096"
  };

  const createBotMock = () => {
    const webhookHandler = jest.fn();
    const botLike = {
      telegram: {
        setWebhook: jest.fn(async () => true)
      },
      launch: jest.fn(async () => undefined),
      stop: jest.fn(),
      webhookCallback: jest.fn(() => webhookHandler)
    };

    return {
      bot: botLike as unknown as Telegraf,
      webhookHandler,
      setWebhook: botLike.telegram.setWebhook,
      launch: botLike.launch,
      stop: botLike.stop,
      webhookCallback: botLike.webhookCallback
    };
  };

  it("boots local polling mode with menu sync, warmup, and periodic command refresh", async () => {
    /* Local runtime should launch polling and still keep command/menu state refreshed on startup. */
    const { bot, launch } = createBotMock();
    const app = { use: jest.fn() } as any;
    const syncMiniAppMenuButton = jest.fn(async () => undefined);
    const checkOpenCodeVersionOnBoot = jest.fn(async () => undefined);
    const registerShutdownHandlers = jest.fn();
    const commandSyncRuntime = {
      syncSlashCommands: jest.fn(async () => undefined),
      startPeriodicCommandSync: jest.fn(),
      stopPeriodicCommandSync: jest.fn()
    };

    await launchBotRuntime({
      app,
      bot,
      config: baseConfig,
      commandSyncRuntime,
      closeHttpServer: jest.fn(async () => undefined),
      syncMiniAppMenuButton,
      checkOpenCodeVersionOnBoot,
      registerShutdownHandlers
    });

    expect(syncMiniAppMenuButton).toHaveBeenCalledWith((bot as any).telegram, baseConfig.publicBaseUrl);
    expect(commandSyncRuntime.syncSlashCommands).toHaveBeenCalledWith(1);
    expect(checkOpenCodeVersionOnBoot).toHaveBeenCalledWith(baseConfig, 1);
    expect(commandSyncRuntime.startPeriodicCommandSync).toHaveBeenCalledWith(1);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(app.use).not.toHaveBeenCalled();
    expect(registerShutdownHandlers).toHaveBeenCalledTimes(1);
  });

  it("boots webhook mode with webhook registration and shared shutdown hooks", async () => {
    /* Public HTTPS runtime should avoid polling and expose Telegram webhook through Express. */
    const { bot, webhookHandler, setWebhook, launch, webhookCallback } = createBotMock();
    const app = { use: jest.fn() } as any;
    const syncMiniAppMenuButton = jest.fn(async () => undefined);
    const checkOpenCodeVersionOnBoot = jest.fn(async () => undefined);
    const registerShutdownHandlers = jest.fn();
    const commandSyncRuntime = {
      syncSlashCommands: jest.fn(async () => undefined),
      startPeriodicCommandSync: jest.fn(),
      stopPeriodicCommandSync: jest.fn()
    };

    await launchBotRuntime({
      app,
      bot,
      config: { ...baseConfig, publicBaseUrl: "https://example.com" },
      commandSyncRuntime,
      closeHttpServer: jest.fn(async () => undefined),
      syncMiniAppMenuButton,
      checkOpenCodeVersionOnBoot,
      registerShutdownHandlers
    });

    expect(checkOpenCodeVersionOnBoot).toHaveBeenCalledWith({ ...baseConfig, publicBaseUrl: "https://example.com" }, 1);
    expect(webhookCallback).toHaveBeenCalledWith("/bot/webhook");
    expect(app.use).toHaveBeenCalledTimes(2);
    expect(app.use).toHaveBeenNthCalledWith(2, webhookHandler);
    expect(setWebhook).toHaveBeenCalledWith("https://example.com/bot/webhook");
    expect(syncMiniAppMenuButton).toHaveBeenCalledWith((bot as any).telegram, "https://example.com");
    expect(commandSyncRuntime.syncSlashCommands).toHaveBeenCalledWith(1);
    expect(commandSyncRuntime.startPeriodicCommandSync).toHaveBeenCalledWith(1);
    expect(launch).not.toHaveBeenCalled();
    expect(registerShutdownHandlers).toHaveBeenCalledTimes(1);
  });

  it("keeps webhook boot alive when startup warmup is temporarily unavailable", async () => {
    /* Runtime restarts can leave backend warming up for a few seconds, but webhook bot must still come up and retry later. */
    const { bot, webhookHandler, setWebhook, launch, webhookCallback } = createBotMock();
    const app = { use: jest.fn() } as any;
    const syncMiniAppMenuButton = jest.fn(async () => undefined);
    const checkOpenCodeVersionOnBoot = jest.fn(async () => {
      throw new Error("connect ECONNREFUSED backend");
    });
    const registerShutdownHandlers = jest.fn();
    const commandSyncRuntime = {
      syncSlashCommands: jest.fn(async () => undefined),
      startPeriodicCommandSync: jest.fn(),
      stopPeriodicCommandSync: jest.fn()
    };
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await launchBotRuntime({
      app,
      bot,
      config: { ...baseConfig, publicBaseUrl: "https://example.com" },
      commandSyncRuntime,
      closeHttpServer: jest.fn(async () => undefined),
      syncMiniAppMenuButton,
      checkOpenCodeVersionOnBoot,
      registerShutdownHandlers
    });

    expect(checkOpenCodeVersionOnBoot).toHaveBeenCalledWith({ ...baseConfig, publicBaseUrl: "https://example.com" }, 1);
    expect(webhookCallback).toHaveBeenCalledWith("/bot/webhook");
    expect(app.use).toHaveBeenCalledTimes(2);
    expect(app.use).toHaveBeenNthCalledWith(2, webhookHandler);
    expect(setWebhook).toHaveBeenCalledWith("https://example.com/bot/webhook");
    expect(syncMiniAppMenuButton).toHaveBeenCalledWith((bot as any).telegram, "https://example.com");
    expect(commandSyncRuntime.syncSlashCommands).toHaveBeenCalledWith(1);
    expect(commandSyncRuntime.startPeriodicCommandSync).toHaveBeenCalledWith(1);
    expect(launch).not.toHaveBeenCalled();
    expect(registerShutdownHandlers).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "OpenCode version warmup failed during webhook boot; continuing startup",
      expect.any(Error)
    );
  });
});
