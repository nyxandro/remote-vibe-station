/**
 * @fileoverview Telegram command that issues short-lived browser magic links for OpenCode UI.
 *
 * Exports:
 * - RegisterOpenCodeAccessCommandInput (L16) - Wiring dependencies for command registration.
 * - registerOpenCodeAccessCommand (L23) - Registers /access command in Telegraf.
 */

import { Telegraf } from "telegraf";

import { BotConfig } from "./config";
import { OpenCodeWebAuthService } from "./opencode-web-auth";

export type RegisterOpenCodeAccessCommandInput = {
  bot: Telegraf;
  config: BotConfig;
  webAuth: OpenCodeWebAuthService;
  isAdmin: (id: number | undefined) => boolean;
};

export const registerOpenCodeAccessCommand = (input: RegisterOpenCodeAccessCommandInput): void => {
  /* Issue a one-time short-lived link that upgrades to a long-lived browser cookie. */
  input.bot.command("access", async (ctx) => {
    if (!ctx.from || !input.isAdmin(ctx.from.id)) {
      await ctx.reply("Доступ запрещен");
      return;
    }

    try {
      const adminId = ctx.from.id;
      const token = await input.webAuth.issueMagicLink({ adminId });
      const url = new URL("/opencode-auth/exchange", input.config.opencodePublicBaseUrl);
      url.searchParams.set("token", token);
      const escapedUrl = escapeHtml(url.toString());
      const linkTtl = formatTtlRu(input.webAuth.getLinkTtlMs());
      const sessionTtl = formatTtlRu(input.webAuth.getSessionTtlMs());

      await ctx.reply(
        "🔐 <b>Ссылка для входа во внешний OpenCode:</b>\n" +
          `<a href="${escapedUrl}">Открыть OpenCode</a>\n` +
          `<code>${escapedUrl}</code>\n\n` +
          `Ссылка одноразовая и живет ${linkTtl}. После входа срок браузерной сессии — ${sessionTtl}; она завершается после выхода из браузера.`,
        {
          parse_mode: "HTML",
          link_preview_options: {
            is_disabled: true
          }
        }
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to issue OpenCode access link", error);
      await ctx.reply("Не удалось создать ссылку доступа. Попробуйте еще раз.");
    }
  });
};

const escapeHtml = (value: string): string => {
  /* Protect message markup from accidental HTML breaking characters. */
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
};

const formatTtlRu = (ttlMs: number): string => {
  /* Keep TTL hint synchronized with auth service config values. */
  const totalMinutes = Math.round(ttlMs / 60000);
  if (totalMinutes >= 1440 && totalMinutes % 1440 === 0) {
    const days = totalMinutes / 1440;
    return formatCountRu(days, ["день", "дня", "дней"]);
  }
  if (totalMinutes >= 60 && totalMinutes % 60 === 0) {
    const hours = totalMinutes / 60;
    return formatCountRu(hours, ["час", "часа", "часов"]);
  }
  return formatCountRu(totalMinutes, ["минута", "минуты", "минут"]);
};

const formatCountRu = (count: number, forms: [string, string, string]): string => {
  /* Minimal Russian plural rules for short TTL messages. */
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return `${count} ${forms[0]}`;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} ${forms[1]}`;
  }
  return `${count} ${forms[2]}`;
};
