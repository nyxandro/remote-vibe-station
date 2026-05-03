/**
 * @fileoverview Registration for core admin-facing Telegram commands.
 *
 * Exports:
 * - registerAdminProjectCommands - Wires /start, /chat, /end, /projects and /project handlers.
 */

import { Telegraf } from "telegraf";

import { fetchActiveSessionTitle, formatActiveSessionLine } from "./active-session";
import { buildBackendErrorMessage } from "./backend-error";
import { buildBotBackendHeaders } from "./backend-auth";
import { BotConfig } from "./config";
import { modeReplyKeyboard } from "./mode-control";
import { buildStartSummaryMessage, fetchStartupSummary } from "./start-summary";

export const registerAdminProjectCommands = (input: {
  bot: Telegraf;
  config: BotConfig;
  isAdmin: (id: number | undefined) => boolean;
  bindChat: (adminId: number, chatId: number) => Promise<void>;
  syncSlashCommands: (adminId: number) => Promise<void>;
}): void => {
  const toggleStreamState = async (entry: {
    adminId: number;
    chatId: number;
    enabled: boolean;
  }): Promise<{ ok: boolean; errorMessage: string | null }> => {
    /* Stream on/off stays backend-authoritative so chat commands do not drift from persisted runtime state. */
    let response: Response;
    try {
      response = await fetch(
        `${input.config.backendUrl}/api/telegram/stream/${entry.enabled ? "on" : "off"}`,
        {
          method: "POST",
          headers: buildBotBackendHeaders(input.config, entry.adminId, {
            "Content-Type": "application/json"
          }),
          body: JSON.stringify({ adminId: entry.adminId, chatId: entry.chatId })
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, errorMessage: `Ошибка backend: ${message}` };
    }

    if (response.ok) {
      return { ok: true, errorMessage: null };
    }

    return {
      ok: false,
      errorMessage: buildBackendErrorMessage(response.status, await response.text())
    };
  };

  input.bot.command("start", async (ctx) => {
    /* Telegram standard entrypoint; refresh slash menu first, then render current project/session summary. */
    if (!input.isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    try {
      await input.syncSlashCommands(ctx.from!.id);
    } catch {
      await ctx.reply("Не удалось обновить список slash-команд OpenCode.");
    }

    try {
      const summary = await fetchStartupSummary(input.config, ctx.from!.id);
      if (summary.project) {
        try {
          const activeSessionTitle = await fetchActiveSessionTitle(input.config, ctx.from!.id);
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

  input.bot.command("chat", async (ctx) => {
    /* Bind this chat as the always-on Telegram delivery target. */
    if (!input.isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    const adminId = ctx.from!.id;
    try {
      await input.bindChat(adminId, ctx.chat.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.error(`Failed to bind Telegram chat ${ctx.chat.id} for admin ${adminId}`, error);
      await ctx.reply(`Не удалось привязать Telegram чат к backend: ${message}`);
      return;
    }

    const toggle = await toggleStreamState({ adminId, chatId: ctx.chat.id, enabled: true });
    if (!toggle.ok) {
      await ctx.reply(toggle.errorMessage ?? "Ошибка backend (500)");
      return;
    }

    await ctx.reply("Поток включен для этого чата. Он теперь работает всегда и не требует ручного выключения.");
  });

  input.bot.command("end", async (ctx) => {
    /* Streaming is now an always-on delivery mode; keep the command as a harmless compatibility hint. */
    if (!input.isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }
    await ctx.reply("Поток всегда включен. Чтобы остановить текущий запуск агента, используй /stop.");
  });

  input.bot.command("projects", async (ctx) => {
    /* List discovered projects with runnable marker so selection stays explicit in Telegram. */
    if (!input.isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    let response: Response;
    try {
      response = await fetch(`${input.config.backendUrl}/api/admin/projects`, {
        headers: buildBotBackendHeaders(input.config, Number(ctx.from?.id))
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.reply(`Ошибка backend: ${message}`);
      return;
    }

    if (!response.ok) {
      await ctx.reply(buildBackendErrorMessage(response.status, null));
      return;
    }

    const items = (await response.json()) as Array<{ slug: string; runnable: boolean }>;
    const lines = items
      .slice(0, 50)
      .map((project) => `- ${project.slug}${project.runnable ? "" : " (no-compose)"}`)
      .join("\n");
    await ctx.reply(`Проекты:\n${lines}\n\nВыбор: /project <slug>`);
  });

  input.bot.command("project", async (ctx) => {
    /* Select active project, then refresh project-scoped slash command aliases. */
    if (!input.isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    const parts = ctx.message.text.trim().split(/\s+/g);
    const slug = parts[1];
    if (!slug) {
      await ctx.reply("Использование: /project <slug>");
      return;
    }

    let response: Response;
    try {
      response = await fetch(
        `${input.config.backendUrl}/api/admin/projects/${encodeURIComponent(slug)}/select`,
        {
          method: "POST",
          headers: buildBotBackendHeaders(input.config, Number(ctx.from?.id), {
            "Content-Type": "application/json",
            /* Bot will reply itself; avoid duplicate project.selected event. */
            "x-suppress-events": "1"
          }),
          body: "{}"
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.reply(`Ошибка backend: ${message}`);
      return;
    }

    if (!response.ok) {
      const body = await response.text();
      await ctx.reply(buildBackendErrorMessage(response.status, body));
      return;
    }

    const project = (await response.json()) as { slug: string; rootPath: string };

    let sessionLine = formatActiveSessionLine(null);
    try {
      const activeSessionTitle = await fetchActiveSessionTitle(input.config, ctx.from!.id);
      sessionLine = formatActiveSessionLine(activeSessionTitle);
    } catch {
      sessionLine = formatActiveSessionLine(null);
    }

    await ctx.reply(`📁 Выбран проект: ${project.slug}\n${project.rootPath}\n${sessionLine}`);

    try {
      await input.syncSlashCommands(ctx.from!.id);
    } catch {
      await ctx.reply("Проект выбран, но список команд OpenCode не обновлен.");
    }
  });
};
