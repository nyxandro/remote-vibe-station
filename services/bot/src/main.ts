/**
 * @fileoverview Telegram bot bootstrap and handlers.
 *
 * Exports:
 * - DEFAULT_PORT (L38) - Default HTTP port for webhook.
 * - bootstrap (L41) - Starts bot, outbox worker, slash sync, and transport mode.
 */

import express from "express";
import { isIP } from "node:net";
import { Markup, Telegraf } from "telegraf";

import { buildBackendErrorMessage } from "./backend-error";
import { fetchActiveSessionTitle, formatActiveSessionLine } from "./active-session";
import { startPeriodicTask } from "./command-sync";
import { loadConfig } from "./config";
import { modeReplyKeyboard, registerModeControl } from "./mode-control";
import { registerOpenCodeCallbacks } from "./opencode-callbacks";
import { registerOpenCodeAccessCommand } from "./opencode-access-command";
import { registerOpenCodeWebAuthHttp } from "./opencode-web-auth-http";
import { OpenCodeWebAuthService } from "./opencode-web-auth";
import { registerRepairCommand } from "./repair-command";
import { registerSessionCommands } from "./session-command";
import { createWebToken } from "./web-token";
import { OutboxWorker } from "./outbox-worker";
import { buildStartSummaryMessage, fetchStartupSummary } from "./start-summary";
import { ThinkingIndicator } from "./thinking-indicator";
import {
  BOT_LOCAL_COMMAND_NAMES,
  TelegramMenuCommand,
  parseSlashCommand
} from "./telegram-commands";
import {
  VOICE_TRANSCRIPTION_NOT_CONFIGURED_MESSAGE,
  VOICE_TRANSCRIPTION_PROGRESS_MESSAGE,
  buildTranscriptionSuccessHtml,
  extractTelegramVoiceInput,
  fetchVoiceControlSettings,
  transcribeTelegramAudioWithGroq,
  validateVoiceInput
} from "./voice-control";

const DEFAULT_PORT = 3001;
const COMMAND_SYNC_INTERVAL_MS = 60_000;
const OPENCODE_WEB_AUTH_STORAGE_FILE = "/app/data/opencode-web-auth.json";
const OPENCODE_WEB_AUTH_LINK_TTL_MS = 5 * 60 * 1000;
const OPENCODE_WEB_AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OPENCODE_WEB_AUTH_COOKIE_NAME = "opencode_sid";

const resolvePort = (value: string | undefined): number => {
  /* Parse user-provided PORT and fall back to default on invalid values. */
  if (!value) {
    return DEFAULT_PORT;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    // eslint-disable-next-line no-console
    console.warn(`Invalid PORT value '${value}', fallback to ${DEFAULT_PORT}`);
    return DEFAULT_PORT;
  }

  return parsed;
};

const shouldSetCookieDomain = (hostname: string): boolean => {
  /* Localhost/IP deployments require host-only cookies without Domain attribute. */
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1") {
    return false;
  }
  return isIP(normalized) === 0;
};

const bootstrap = async (): Promise<void> => {
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
  let periodicCommandSyncStop: (() => void) | null = null;
  let opencodeCommandLookup = new Map<string, string>();

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
    opencodeCookieDomain = shouldSetCookieDomain(hostname) ? hostname : undefined;
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
    cookieMaxAgeMs: OPENCODE_WEB_AUTH_SESSION_TTL_MS,
    cookieDomain: opencodeCookieDomain
  });

  const bindChat = async (adminId: number, chatId: number): Promise<void> => {
    /* Tell backend which chat should receive stream output for this admin. */
    const response = await fetch(`${config.backendUrl}/api/telegram/bind`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-id": String(adminId)
      },
      body: JSON.stringify({ adminId, chatId })
    });

    if (!response.ok) {
      throw new Error(`Failed to bind chat: ${response.status} ${await response.text()}`);
    }
  };

  const syncSlashCommands = async (adminId: number): Promise<void> => {
    /*
     * Telegram suggests commands from setMyCommands.
     * Backend returns a normalized catalog with merged local+OpenCode commands.
     */
    const response = await fetch(`${config.backendUrl}/api/telegram/commands`, {
      headers: { "x-admin-id": String(adminId) }
    });

    if (!response.ok) {
      throw new Error(`Failed to sync commands: ${response.status}`);
    }

    const body = (await response.json()) as {
      commands?: TelegramMenuCommand[];
      lookup?: Record<string, string>;
    };

    const menuCommands = Array.isArray(body.commands) ? body.commands : [];
    opencodeCommandLookup = new Map(
      Object.entries(body.lookup ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"
      )
    );

    await bot.telegram.setMyCommands(menuCommands);
  };

  const startPeriodicCommandSync = (adminId: number): void => {
    /* Refresh slash-menu periodically so Telegram suggestions stay актуальными. */
    const controller = startPeriodicTask({
      intervalMs: COMMAND_SYNC_INTERVAL_MS,
      run: async () => {
        await syncSlashCommands(adminId);
      },
      onError: (error) => {
        // eslint-disable-next-line no-console
        console.error("Periodic slash sync failed", error);
      }
    });

    periodicCommandSyncStop = controller.stop;
  };

  const stopPeriodicCommandSync = (): void => {
    /* Ensure timer cleanup during shutdown/reload. */
    periodicCommandSyncStop?.();
    periodicCommandSyncStop = null;
  };

  bot.command("open", async (ctx) => {
    /* Provide Mini App link to admin users. */
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    const url = `${config.publicBaseUrl}/miniapp`;
    const token = createWebToken({ adminId: ctx.from!.id, botToken: config.telegramBotToken });
    const browserUrl = `${url}/#token=${token}`;

    /* Telegram WebApp buttons require HTTPS; fallback to plain link in dev. */
    if (url.startsWith("https://")) {
      const button = Markup.button.webApp("Open Mini App", url);
      await ctx.reply("Mini App", Markup.inlineKeyboard([button]));
      await ctx.reply(`Browser link: ${browserUrl}`);
      return;
    }

    await ctx.reply(`Mini App (dev): ${browserUrl}`);
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

  bot.command("start", async (ctx) => {
    /* Telegram standard entrypoint; do not forward to OpenCode. */
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    /* Refresh menu first, then show state snapshot built from backend source of truth. */
    try {
      await syncSlashCommands(ctx.from!.id);
    } catch {
      await ctx.reply("Не удалось обновить список slash-команд OpenCode.");
    }

    try {
      const summary = await fetchStartupSummary(config.backendUrl, ctx.from!.id);
      /* Session line for /start should reflect currently active OpenCode thread title. */
      if (summary.project) {
        try {
          const activeSessionTitle = await fetchActiveSessionTitle(config.backendUrl, ctx.from!.id);
          summary.session = activeSessionTitle ? { title: activeSessionTitle } : null;
        } catch {
          summary.session = null;
        }
      } else {
        summary.session = null;
      }

      await ctx.reply(buildStartSummaryMessage(summary), modeReplyKeyboard());
    } catch {
      await ctx.reply(
        "Привет! Не удалось получить стартовую сводку. " +
          "Проверь /project, затем используй /mode и /chat для работы.",
        modeReplyKeyboard()
      );
    }
  });

  bot.command("chat", async (ctx) => {
    /* Enable streaming of agent output to this chat. */
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    const adminId = ctx.from!.id;
    await bindChat(adminId, ctx.chat.id);

    /* Persist stream state on backend (source of truth). */
    await fetch(`${config.backendUrl}/api/telegram/stream/on`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-id": String(adminId)
      },
      body: JSON.stringify({ adminId, chatId: ctx.chat.id })
    });

    await ctx.reply("Поток включен для этого чата. /end чтобы выключить.");
  });

  bot.command("end", async (ctx) => {
    /* Disable streaming to this chat without stopping the agent. */
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    const adminId = ctx.from!.id;
    await bindChat(adminId, ctx.chat.id);

    await fetch(`${config.backendUrl}/api/telegram/stream/off`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-id": String(adminId)
      },
      body: JSON.stringify({ adminId, chatId: ctx.chat.id })
    });

    await ctx.reply("Поток выключен. /chat чтобы включить снова.");
  });

  bot.command("projects", async (ctx) => {
    /* List discovered projects. */
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    const response = await fetch(`${config.backendUrl}/api/admin/projects`, {
      headers: { "x-admin-id": String(ctx.from?.id) }
    });

    if (!response.ok) {
      await ctx.reply(buildBackendErrorMessage(response.status, null));
      return;
    }

    const items = (await response.json()) as Array<{ slug: string; runnable: boolean }>;
    const lines = items
      .slice(0, 50)
      .map((p) => `- ${p.slug}${p.runnable ? "" : " (no-compose)"}`)
      .join("\n");
    await ctx.reply(`Проекты:\n${lines}\n\nВыбор: /project <slug>`);
  });

  bot.command("project", async (ctx) => {
    /* Select active project for subsequent prompts. */
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    const parts = ctx.message.text.trim().split(/\s+/g);
    const slug = parts[1];
    if (!slug) {
      await ctx.reply("Использование: /project <slug>");
      return;
    }

    const response = await fetch(
      `${config.backendUrl}/api/admin/projects/${encodeURIComponent(slug)}/select`,
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-id": String(ctx.from?.id),
        /* Bot will reply itself; avoid duplicate project.selected event. */
        "x-suppress-events": "1"
      },
      body: "{}"
      }
    );

    if (!response.ok) {
      const body = await response.text();
      await ctx.reply(buildBackendErrorMessage(response.status, body));
      return;
    }

    const project = (await response.json()) as { slug: string; rootPath: string };

    /* Show active session context immediately after project switch. */
    let sessionLine = formatActiveSessionLine(null);
    try {
      const activeSessionTitle = await fetchActiveSessionTitle(config.backendUrl, ctx.from!.id);
      sessionLine = formatActiveSessionLine(activeSessionTitle);
    } catch {
      sessionLine = formatActiveSessionLine(null);
    }

    await ctx.reply(`📁 Выбран проект: ${project.slug}\n${project.rootPath}\n${sessionLine}`);

    /* Re-sync command menu to include project-level custom commands. */
    try {
      await syncSlashCommands(ctx.from!.id);
    } catch {
      await ctx.reply("Проект выбран, но список команд OpenCode не обновлен.");
    }
  });

  const submitPromptText = async (input: {
    adminId: number;
    chatId: number;
    text: string;
    errorLabel: string;
  }): Promise<void> => {
    /* Reuse common prompt submission flow for text and transcribed voice messages. */
    await bindChat(input.adminId, input.chatId);
    await indicator.start(input.chatId);

    void (async () => {
      try {
        const response = await fetch(`${config.backendUrl}/api/prompt`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-id": String(input.adminId)
          },
          body: JSON.stringify({ text: input.text })
        });

        if (!response.ok) {
          const body = await response.text();
          await indicator.stop(input.chatId);
          await bot.telegram.sendMessage(input.chatId, buildBackendErrorMessage(response.status, body));
          return;
        }

        await response.json();
        await indicator.stop(input.chatId);
      } catch (error) {
        await indicator.stop(input.chatId);
        const message = error instanceof Error ? error.message : String(error);
        await bot.telegram.sendMessage(input.chatId, `${input.errorLabel}: ${message}`);
      }
    })();
  };

  bot.on("voice", async (ctx) => {
    /* Convert Telegram voice note to text and forward it to OpenCode prompt API. */
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    const voiceInput = extractTelegramVoiceInput(ctx.message);
    if (!voiceInput) {
      return;
    }

    const adminId = ctx.from!.id;
    const chatId = ctx.chat.id;

    const validationError = validateVoiceInput(voiceInput);
    if (validationError) {
      await ctx.reply(validationError);
      return;
    }

    let statusMessageId: number | null = null;
    try {
      const settings = await fetchVoiceControlSettings(config.backendUrl, adminId);
      if (!settings.enabled || !settings.apiKey || !settings.model) {
        await ctx.reply(VOICE_TRANSCRIPTION_NOT_CONFIGURED_MESSAGE);
        return;
      }

      const statusMessage = await ctx.reply(VOICE_TRANSCRIPTION_PROGRESS_MESSAGE);
      statusMessageId = statusMessage.message_id;

      const telegramFileUrl = String(await ctx.telegram.getFileLink(voiceInput.fileId));
      const transcribedText = await transcribeTelegramAudioWithGroq({
        telegramFileUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        mimeType: voiceInput.mimeType
      });

      if (statusMessageId !== null) {
        await ctx.telegram.editMessageText(
          chatId,
          statusMessageId,
          undefined,
          buildTranscriptionSuccessHtml(transcribedText),
          {
            parse_mode: "HTML"
          }
        );
      }

      await submitPromptText({
        adminId,
        chatId,
        text: transcribedText,
        errorLabel: "Ошибка запроса"
      });
    } catch {
      if (statusMessageId !== null) {
        await ctx.telegram.editMessageText(
          chatId,
          statusMessageId,
          undefined,
          VOICE_TRANSCRIPTION_NOT_CONFIGURED_MESSAGE
        );
        return;
      }
      await ctx.reply(VOICE_TRANSCRIPTION_NOT_CONFIGURED_MESSAGE);
    }
  });

  bot.on("text", async (ctx) => {
    /* Handle prompt messages from admin. */
    if (!isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    /* Do not forward bot commands as prompts. */
    const text = ctx.message.text.trim();
    const adminId = ctx.from!.id;
    const chatId = ctx.chat.id;
    const slash = parseSlashCommand(text);
    if (slash) {
      /*
       * Local commands are handled by dedicated bot.command handlers above.
       * For other commands, forward to OpenCode command execution endpoint.
       */
      if (BOT_LOCAL_COMMAND_NAMES.has(slash.command)) {
        return;
      }

      let resolvedCommand = opencodeCommandLookup.get(slash.command);
      if (!resolvedCommand) {
        /* Re-sync once before rejecting to reduce stale-menu race conditions. */
        try {
          await syncSlashCommands(ctx.from!.id);
        } catch {
          // ignore
        }

        resolvedCommand = opencodeCommandLookup.get(slash.command);
        if (!resolvedCommand) {
          await ctx.reply(`Неизвестная команда: /${slash.command}`);
          return;
        }
      }

      await bindChat(adminId, chatId);
      await indicator.start(chatId);

      /*
       * Run command call in background to avoid Telegraf 90s middleware timeout.
       * Outbox still delivers normal responses when backend finishes.
       */
      void (async () => {
        try {
          const commandResponse = await fetch(`${config.backendUrl}/api/telegram/command`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-admin-id": String(adminId)
            },
            body: JSON.stringify({
              command: resolvedCommand,
              arguments: slash.args
            })
          });

          if (!commandResponse.ok) {
            const body = await commandResponse.text();
            await indicator.stop(chatId);
            await bot.telegram.sendMessage(
              chatId,
              buildBackendErrorMessage(commandResponse.status, body)
            );
            return;
          }

          await commandResponse.json();
          await indicator.stop(chatId);
        } catch (error) {
          await indicator.stop(chatId);
          const message = error instanceof Error ? error.message : String(error);
          await bot.telegram.sendMessage(chatId, `Ошибка команды: ${message}`);
        }
      })();
      return;
    }

    if (text.length === 0) {
      await ctx.reply("Empty prompt");
      return;
    }

    await submitPromptText({
      adminId,
      chatId,
      text,
      errorLabel: "Ошибка запроса"
    });
  });

  /* Start webhook server and bot. */

  /*
   * Local dev uses polling (no public HTTPS required).
   * Webhook mode is used when PUBLIC_BASE_URL is a real HTTPS URL.
   */
  const isLocal =
    config.publicBaseUrl.startsWith("http://localhost") ||
    config.publicBaseUrl.startsWith("http://127.0.0.1");
  const primaryAdminId =
    Array.isArray(config.adminIds) && typeof config.adminIds[0] === "number" ? config.adminIds[0] : null;

  const checkOpenCodeVersionOnBoot = async (adminId: number): Promise<void> => {
    /* Refresh backend OpenCode version cache once on bot startup. */
    try {
      const response = await fetch(`${config.backendUrl}/api/telegram/opencode/version/check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-id": String(adminId)
        },
        body: "{}"
      });

      if (!response.ok) {
        throw new Error(`status=${response.status}`);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("OpenCode version check on boot failed", error);
    }
  };

  /* Keep auth endpoints reachable in both polling and webhook modes. */
  const port = resolvePort(process.env.PORT);
  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Bot HTTP server is listening on port ${port}`);
  });

  server.on("error", (error) => {
    // eslint-disable-next-line no-console
    console.error("Bot HTTP server failed to start", error);
    process.exit(1);
  });

  const closeHttpServer = async (): Promise<void> => {
    /* Ensure HTTP listener is closed during process shutdown. */
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  };

  const registerShutdownHandlers = (): void => {
    /* Keep shutdown flow identical for polling and webhook modes. */
    process.once("SIGINT", () => {
      void (async () => {
        stopPeriodicCommandSync();
        bot.stop("SIGINT");
        await closeHttpServer();
      })();
    });
    process.once("SIGTERM", () => {
      void (async () => {
        stopPeriodicCommandSync();
        bot.stop("SIGTERM");
        await closeHttpServer();
      })();
    });
  };

  if (isLocal) {
    /* Best-effort initial slash command sync for Telegram menu suggestions. */
    if (primaryAdminId !== null) {
      try {
        await syncSlashCommands(primaryAdminId);
      } catch {
        // ignore
      }
    }

    if (primaryAdminId !== null) {
      await checkOpenCodeVersionOnBoot(primaryAdminId);
    }

    if (primaryAdminId !== null) {
      startPeriodicCommandSync(primaryAdminId);
    }

    await bot.launch();
    registerShutdownHandlers();

    return;
  }

  if (primaryAdminId !== null) {
    await checkOpenCodeVersionOnBoot(primaryAdminId);
  }

  app.use(bot.webhookCallback("/bot/webhook"));

  await bot.telegram.setWebhook(`${config.publicBaseUrl}/bot/webhook`);

  /* Best-effort initial slash command sync for webhook mode. */
  if (primaryAdminId !== null) {
    try {
      await syncSlashCommands(primaryAdminId);
    } catch {
      // ignore
    }
  }

  if (primaryAdminId !== null) {
    startPeriodicCommandSync(primaryAdminId);
  }

  registerShutdownHandlers();
};

void bootstrap();
