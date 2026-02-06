/**
 * @fileoverview Telegram bot bootstrap and handlers.
 *
 * Exports:
 * - DEFAULT_PORT (L26) - Default HTTP port for webhook.
 * - bootstrap (L28) - Starts bot, outbox worker, slash sync, and transport mode.
 */

import express from "express";
import { Markup, Telegraf } from "telegraf";

import { startPeriodicTask } from "./command-sync";
import { loadConfig } from "./config";
import { modeReplyKeyboard, registerModeControl } from "./mode-control";
import { createWebToken } from "./web-token";
import { OutboxWorker } from "./outbox-worker";
import { ThinkingIndicator } from "./thinking-indicator";
import {
  BOT_LOCAL_COMMAND_NAMES,
  OpenCodeCommand,
  buildOpenCodeCommandLookup,
  buildTelegramMenuCommands,
  parseSlashCommand
} from "./telegram-commands";

const DEFAULT_PORT = 3001;
const COMMAND_SYNC_INTERVAL_MS = 60_000;

const bootstrap = async (): Promise<void> => {
  /* Load configuration and initialize bot. */
  const config = loadConfig();
  const bot = new Telegraf(config.telegramBotToken);
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

  bot.on("callback_query", async (ctx) => {
    /* Handle OpenCode question replies from inline keyboard buttons. */
    const raw = "data" in ctx.callbackQuery ? String(ctx.callbackQuery.data ?? "") : "";
    if (!raw.startsWith("q|")) {
      return;
    }

    if (!isAdmin(ctx.from?.id)) {
      await ctx.answerCbQuery("Access denied", { show_alert: true });
      return;
    }

    const parts = raw.split("|");
    const questionToken = parts[1] ?? "";
    const optionIndex = Number(parts[2] ?? "-1");
    if (!questionToken || !Number.isInteger(optionIndex) || optionIndex < 0) {
      await ctx.answerCbQuery("Некорректный ответ", { show_alert: true });
      return;
    }

    const response = await fetch(`${config.backendUrl}/api/telegram/question/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-id": String(ctx.from?.id)
      },
      body: JSON.stringify({ questionToken, optionIndex })
    });

    if (!response.ok) {
      const text = await response.text();
      await ctx.answerCbQuery("Не удалось отправить ответ", { show_alert: true });
      await ctx.reply(`Ошибка ответа на вопрос OpenCode: ${text}`);
      return;
    }

    const payload = (await response.json()) as { selected?: string };
    await ctx.answerCbQuery("Ответ отправлен");
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    if (payload.selected) {
      await ctx.reply(`Выбран ответ: ${payload.selected}`);
    }
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
     * We merge local bot commands with the OpenCode command list from backend.
     */
    const response = await fetch(`${config.backendUrl}/api/telegram/commands`, {
      headers: { "x-admin-id": String(adminId) }
    });

    if (!response.ok) {
      throw new Error(`Failed to sync commands: ${response.status}`);
    }

    const body = (await response.json()) as { commands?: OpenCodeCommand[] };
    const commands = Array.isArray(body.commands) ? body.commands : [];
    opencodeCommandLookup = buildOpenCodeCommandLookup(commands);

    const menuCommands = buildTelegramMenuCommands(commands);
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

    await ctx.reply(
      "Ky-ky!\n\n" +
        "1) /open - open the Mini App\n" +
        "2) Select a project in the Mini App\n" +
        "3) /chat - start streaming agent output here\n" +
        "4) Send me a message to talk to the agent\n" +
        "Use /end to stop streaming.",
      modeReplyKeyboard()
    );

    /* Refresh Telegram slash menu for this admin context. */
    try {
      await syncSlashCommands(ctx.from!.id);
    } catch {
      await ctx.reply("Не удалось обновить список slash-команд OpenCode.");
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
      await ctx.reply(`Backend error: ${response.status}`);
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
      await ctx.reply(`Не удалось выбрать проект (${response.status}): ${body}`);
      return;
    }

    const project = (await response.json()) as { slug: string; rootPath: string };
    await ctx.reply(`📁 Выбран проект: ${project.slug}\n${project.rootPath}`);

    /* Re-sync command menu to include project-level custom commands. */
    try {
      await syncSlashCommands(ctx.from!.id);
    } catch {
      await ctx.reply("Проект выбран, но список команд OpenCode не обновлен.");
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
            await bot.telegram.sendMessage(chatId, `Backend error: ${commandResponse.status}\n${body}`);
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

    await bindChat(adminId, chatId);

    /* Show a single animated message while backend/OpenCode works. */
    await indicator.start(chatId);

    /*
     * Prompt call can be long-running; execute it out of handler flow.
     * This avoids Telegraf TimeoutError while backend/OpenCode work proceeds.
     */
    void (async () => {
      try {
        const response = await fetch(`${config.backendUrl}/api/prompt`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-id": String(adminId)
          },
          body: JSON.stringify({ text })
        });

        if (!response.ok) {
          const body = await response.text();
          await indicator.stop(chatId);
          await bot.telegram.sendMessage(chatId, `Backend error: ${response.status}\n${body}`);
          return;
        }

        await response.json();
        await indicator.stop(chatId);
      } catch (error) {
        await indicator.stop(chatId);
        const message = error instanceof Error ? error.message : String(error);
        await bot.telegram.sendMessage(chatId, `Ошибка запроса: ${message}`);
      }
    })();
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
      startPeriodicCommandSync(primaryAdminId);
    }

    await bot.launch();

    process.once("SIGINT", () => {
      stopPeriodicCommandSync();
      bot.stop("SIGINT");
    });
    process.once("SIGTERM", () => {
      stopPeriodicCommandSync();
      bot.stop("SIGTERM");
    });

    return;
  }

  const app = express();
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

  const port = process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT;
  app.listen(port);

  process.once("SIGINT", () => {
    stopPeriodicCommandSync();
    bot.stop("SIGINT");
  });
  process.once("SIGTERM", () => {
    stopPeriodicCommandSync();
    bot.stop("SIGTERM");
  });
};

void bootstrap();
