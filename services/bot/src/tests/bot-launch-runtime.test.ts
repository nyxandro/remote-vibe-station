/**
 * @fileoverview Tests for bot launch runtime orchestration.
 */

import { Telegraf } from "telegraf";
import { createTelegramWebhookMiddleware } from "../telegram-webhook-http";

import { launchBotRuntime } from "../bot-launch-runtime";
import { BotConfig } from "../config";

describe("launchBotRuntime", () => {
  const baseConfig: BotConfig = {
    telegramBotToken: "token",
    adminIds: [1],
    backendUrl: "http://backend:3000",
    botBackendAuthToken: "secret-token",
    publicBaseUrl: "http://localhost:4173",
    opencodePublicBaseUrl: "http://localhost:4096",
    transportMode: "auto"
  };

  const createBotMock = () => {
    const botLike = {
      telegram: {
        setWebhook: jest.fn(async () => true)
      },
      launch: jest.fn(async () => undefined),
      stop: jest.fn(),
      handleUpdate: jest.fn(async () => undefined)
    };

    return {
      bot: botLike as unknown as Telegraf,
      setWebhook: botLike.telegram.setWebhook,
      launch: botLike.launch,
      stop: botLike.stop,
      handleUpdate: botLike.handleUpdate
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

  it("boots forced polling mode even with public HTTPS base url", async () => {
    /* Production runtime must be able to bypass webhook delivery when Telegram cannot reliably reach the public endpoint. */
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
      config: { ...baseConfig, publicBaseUrl: "https://example.com", transportMode: "polling" },
      commandSyncRuntime,
      closeHttpServer: jest.fn(async () => undefined),
      syncMiniAppMenuButton,
      checkOpenCodeVersionOnBoot,
      registerShutdownHandlers
    });

    expect(launch).toHaveBeenCalledTimes(1);
    expect(app.use).not.toHaveBeenCalled();
    expect(commandSyncRuntime.startPeriodicCommandSync).toHaveBeenCalledWith(1);
  });

  it("keeps polling startup alive when Telegram menu sync times out", async () => {
    /* Telegram API reachability is flaky in production, but polling must still come up and consume updates. */
    const { bot, launch } = createBotMock();
    const app = { use: jest.fn() } as any;
    const syncMiniAppMenuButton = jest.fn(async () => {
      throw new Error("telegram timeout");
    });
    const checkOpenCodeVersionOnBoot = jest.fn(async () => undefined);
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
      config: { ...baseConfig, transportMode: "polling" },
      commandSyncRuntime,
      closeHttpServer: jest.fn(async () => undefined),
      syncMiniAppMenuButton,
      checkOpenCodeVersionOnBoot,
      registerShutdownHandlers
    });

    expect(launch).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "Mini App menu sync failed during polling boot; continuing startup",
      expect.any(Error)
    );
  });

  it("boots webhook mode with webhook registration and shared shutdown hooks", async () => {
    /* Public HTTPS runtime should avoid polling and expose Telegram webhook through Express. */
    const { bot, setWebhook, launch } = createBotMock();
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
    expect(app.use).toHaveBeenCalledTimes(1);
    expect(app.use).toHaveBeenNthCalledWith(1, "/bot/webhook", expect.any(Function));
    expect(setWebhook).toHaveBeenCalledWith("https://example.com/bot/webhook");
    expect(syncMiniAppMenuButton).toHaveBeenCalledWith((bot as any).telegram, "https://example.com");
    expect(commandSyncRuntime.syncSlashCommands).toHaveBeenCalledWith(1);
    expect(commandSyncRuntime.startPeriodicCommandSync).toHaveBeenCalledWith(1);
    expect(launch).not.toHaveBeenCalled();
    expect(registerShutdownHandlers).toHaveBeenCalledTimes(1);
  });

  it("keeps webhook boot alive when startup warmup is temporarily unavailable", async () => {
    /* Runtime restarts can leave backend warming up for a few seconds, but webhook bot must still come up and retry later. */
    const { bot, setWebhook, launch } = createBotMock();
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
    expect(app.use).toHaveBeenCalledTimes(1);
    expect(app.use).toHaveBeenNthCalledWith(1, "/bot/webhook", expect.any(Function));
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

  it("acknowledges Telegram webhook before async handler completion", async () => {
    /* Telegram must receive HTTP 200 immediately so slow Bot API calls do not trigger webhook retries. */
    let releaseUpdate!: () => void;
    const handleUpdate = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseUpdate = resolve;
        })
    );
    const middleware = createTelegramWebhookMiddleware({ handleUpdate } as unknown as Telegraf);
    const response = {
      status: jest.fn().mockReturnThis(),
      end: jest.fn()
    } as any;

    middleware(
      {
        body: {
          update_id: 1,
          message: {
            message_id: 2,
            text: "/start",
            chat: { id: 77 },
            from: { id: 1 }
          }
        }
      } as any,
      response,
      jest.fn()
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.end).toHaveBeenCalledTimes(1);
    expect(handleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        update_id: 1
      })
    );

    releaseUpdate();
    await Promise.resolve();
  });
});
