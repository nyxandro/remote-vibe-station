/**
 * @fileoverview Telegram commands and callbacks for OpenCode session management.
 *
 * Exports:
 * - registerSessionCommands (L62) - Registers /new, /stop, /sessions and session picker callbacks.
 */

import { Markup, Telegraf } from "telegraf";

import { fetchActiveSessionTitle, formatActiveSessionLine } from "./active-session";
import { buildBotBackendHeaders } from "./backend-auth";
import { buildBackendErrorMessage } from "./backend-error";
import { BotConfig } from "./config";

type SessionListPayload = {
  ok: true;
  projectSlug: string;
  sessions: Array<{
    sessionToken: string;
    title: string | null;
    status: string;
    updatedAt: string | null;
    active: boolean;
  }>;
};

const SESSION_CALLBACK_PREFIX = "sess|";
const SESSION_SWITCH_TIMEOUT_MS = 12_000;

const formatSessionButton = (item: SessionListPayload["sessions"][number]): string => {
  /* Render compact, readable row for Telegram inline keyboard button text. */
  const marker = item.active ? "●" : "○";
  const title = item.title && item.title.trim().length > 0 ? item.title.trim() : "Без названия";
  const status = item.status === "busy" ? "busy" : "idle";
  return `${marker} ${title} · ${status}`;
};

const parseSessionListPayload = (payload: unknown): SessionListPayload => {
  /* Validate backend response shape before rendering Telegram keyboard. */
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Некорректный ответ sessions");
  }

  const record = payload as Record<string, unknown>;
  if (record.ok !== true || typeof record.projectSlug !== "string" || !Array.isArray(record.sessions)) {
    throw new Error("Некорректный формат списка сессий");
  }

  return {
    ok: true,
    projectSlug: record.projectSlug,
    sessions: record.sessions
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => ({
        sessionToken: String(item.sessionToken ?? "").trim(),
        title: typeof item.title === "string" ? item.title : null,
        status: String(item.status ?? "idle").trim() || "idle",
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
        active: Boolean(item.active)
      }))
      .filter((item) => item.sessionToken.length > 0)
  };
};

export const registerSessionCommands = (input: {
  bot: Telegraf;
  config: BotConfig;
  isAdmin: (id: number | undefined) => boolean;
}): void => {
  /* Register /new command that starts fresh OpenCode session for active project. */
  input.bot.command("new", async (ctx) => {
    if (!input.isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    const response = await fetch(`${input.config.backendUrl}/api/telegram/session/new`, {
      method: "POST",
      headers: buildBotBackendHeaders(input.config, Number(ctx.from?.id))
    });

    if (!response.ok) {
      const body = await response.text();
      await ctx.reply(buildBackendErrorMessage(response.status, body));
      return;
    }

    const payload = (await response.json()) as { ok?: boolean; projectSlug?: string };
    const projectSlug = typeof payload.projectSlug === "string" ? payload.projectSlug : "unknown";
    await ctx.reply(`🆕 Начата новая сессия (проект: ${projectSlug}).`);
  });

  /* Register /stop command that aborts the current active OpenCode session run. */
  input.bot.command("stop", async (ctx) => {
    if (!input.isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    const response = await fetch(`${input.config.backendUrl}/api/telegram/session/stop`, {
      method: "POST",
      headers: buildBotBackendHeaders(input.config, Number(ctx.from?.id))
    });

    if (!response.ok) {
      const body = await response.text();
      await ctx.reply(buildBackendErrorMessage(response.status, body));
      return;
    }

    const payload = (await response.json()) as { ok?: boolean; projectSlug?: string; aborted?: boolean };
    const projectSlug = typeof payload.projectSlug === "string" ? payload.projectSlug : "unknown";
    if (payload.aborted === false) {
      await ctx.reply(`⏹ В текущей сессии уже нет активной работы (проект: ${projectSlug}).`);
      return;
    }

    await ctx.reply(`⏹ Остановил текущий запрос (проект: ${projectSlug}).`);
  });

  /* Register /sessions command that renders session picker via inline callback buttons. */
  input.bot.command("sessions", async (ctx) => {
    if (!input.isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    const response = await fetch(`${input.config.backendUrl}/api/telegram/sessions`, {
      method: "GET",
      headers: buildBotBackendHeaders(input.config, Number(ctx.from?.id))
    });

    if (!response.ok) {
      const body = await response.text();
      await ctx.reply(buildBackendErrorMessage(response.status, body));
      return;
    }

    const payload = parseSessionListPayload(await response.json());
    if (payload.sessions.length === 0) {
      await ctx.reply(`Сессии проекта ${payload.projectSlug} не найдены. Используй /new.`);
      return;
    }

    const keyboard = payload.sessions.slice(0, 12).map((item) => [
      Markup.button.callback(formatSessionButton(item), `${SESSION_CALLBACK_PREFIX}${item.sessionToken}`)
    ]);

    await ctx.reply(
      `Сессии проекта ${payload.projectSlug}:`,
      Markup.inlineKeyboard(keyboard)
    );
  });

  /* Handle inline button callback to switch active OpenCode session. */
  input.bot.on("callback_query", async (ctx) => {
    try {
      const raw = "data" in ctx.callbackQuery ? String(ctx.callbackQuery.data ?? "") : "";
      if (!raw.startsWith(SESSION_CALLBACK_PREFIX)) {
        return;
      }

      if (!input.isAdmin(ctx.from?.id)) {
        await ctx.answerCbQuery("Access denied", { show_alert: true });
        return;
      }

      const sessionToken = raw.slice(SESSION_CALLBACK_PREFIX.length).trim();
      if (!sessionToken) {
        await ctx.answerCbQuery("Некорректный выбор", { show_alert: true });
        return;
      }

      /* Acknowledge click immediately so Telegram UI does not keep spinning. */
      await ctx.answerCbQuery("Переключаю сессию...");

      const response = await fetch(`${input.config.backendUrl}/api/telegram/session/select`, {
        method: "POST",
        headers: buildBotBackendHeaders(input.config, Number(ctx.from?.id), {
          "Content-Type": "application/json"
        }),
        body: JSON.stringify({ sessionToken }),
        signal: AbortSignal.timeout(SESSION_SWITCH_TIMEOUT_MS)
      });

      if (!response.ok) {
        const body = await response.text();
        await ctx.reply(buildBackendErrorMessage(response.status, body));
        return;
      }

      const payload = (await response.json()) as { ok?: boolean; projectSlug?: string };
      const projectSlug = typeof payload.projectSlug === "string" ? payload.projectSlug : "unknown";
      let sessionLine = formatActiveSessionLine(null);
      try {
        const activeSessionTitle = await fetchActiveSessionTitle(input.config, Number(ctx.from?.id));
        sessionLine = formatActiveSessionLine(activeSessionTitle);
      } catch {
        sessionLine = formatActiveSessionLine(null);
      }

      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      await ctx.reply(`✅ Активная сессия переключена (проект: ${projectSlug}).\n${sessionLine}`);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Session select callback failed", error);
      await ctx.reply("Не удалось переключить сессию: таймаут или ошибка сети. Попробуйте еще раз.");
    }
  });
};
