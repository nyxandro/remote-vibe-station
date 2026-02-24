/**
 * @fileoverview Callback handlers for OpenCode inline actions in Telegram.
 *
 * Exports:
 * - OpenCodePermissionResponse (L12) - Allowed permission decision values.
 * - registerOpenCodeCallbacks (L22) - Registers question/permission callback handler.
 */

import { Telegraf } from "telegraf";

import { BotConfig } from "./config";

export type OpenCodePermissionResponse = "once" | "always" | "reject";

const QUESTION_CALLBACK_PREFIX = "q|";
const PERMISSION_CALLBACK_PREFIX = "perm|";
const PERMISSION_RESPONSES: OpenCodePermissionResponse[] = ["once", "always", "reject"];

export const registerOpenCodeCallbacks = (input: {
  bot: Telegraf;
  config: BotConfig;
  isAdmin: (id: number | undefined) => boolean;
}): void => {
  /* Register callback routes for OpenCode question and permission prompts. */
  input.bot.on("callback_query", async (ctx) => {
    const raw = "data" in ctx.callbackQuery ? String(ctx.callbackQuery.data ?? "") : "";
    if (!raw.startsWith(QUESTION_CALLBACK_PREFIX) && !raw.startsWith(PERMISSION_CALLBACK_PREFIX)) {
      return;
    }

    if (!input.isAdmin(ctx.from?.id)) {
      await ctx.answerCbQuery("Access denied", { show_alert: true });
      return;
    }

    if (raw.startsWith(QUESTION_CALLBACK_PREFIX)) {
      await handleQuestionCallback({
        raw,
        adminId: Number(ctx.from?.id),
        backendUrl: input.config.backendUrl,
        answerCbQuery: (text: string, showAlert?: boolean) =>
          ctx.answerCbQuery(text, showAlert ? { show_alert: true } : undefined),
        editInlineKeyboard: () => ctx.editMessageReplyMarkup({ inline_keyboard: [] }),
        sendReply: (text: string) => ctx.reply(text)
      });
      return;
    }

    await handlePermissionCallback({
      raw,
      adminId: Number(ctx.from?.id),
      backendUrl: input.config.backendUrl,
      answerCbQuery: (text: string, showAlert?: boolean) =>
        ctx.answerCbQuery(text, showAlert ? { show_alert: true } : undefined),
      editInlineKeyboard: () => ctx.editMessageReplyMarkup({ inline_keyboard: [] }),
      sendReply: (text: string) => ctx.reply(text)
    });
  });
};

const handleQuestionCallback = async (input: {
  raw: string;
  adminId: number;
  backendUrl: string;
  answerCbQuery: (text: string, showAlert?: boolean) => Promise<unknown>;
  editInlineKeyboard: () => Promise<unknown>;
  sendReply: (text: string) => Promise<unknown>;
}): Promise<void> => {
  /* Route selected question option to backend and clear inline keyboard on success. */
  const parts = input.raw.split("|");
  const questionToken = parts[1] ?? "";
  const optionIndex = Number(parts[2] ?? "-1");
  if (!questionToken || !Number.isInteger(optionIndex) || optionIndex < 0) {
    await input.answerCbQuery("Некорректный ответ", true);
    return;
  }

  const response = await fetch(`${input.backendUrl}/api/telegram/question/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-id": String(input.adminId)
    },
    body: JSON.stringify({ questionToken, optionIndex })
  });

  if (!response.ok) {
    const text = await response.text();
    await input.answerCbQuery("Не удалось отправить ответ", true);
    await input.sendReply(`Ошибка ответа на вопрос OpenCode: ${text}`);
    return;
  }

  const payload = (await response.json()) as { selected?: string };
  await input.answerCbQuery("Ответ отправлен");
  await input.editInlineKeyboard();
  if (payload.selected) {
    await input.sendReply(`Выбран ответ: ${payload.selected}`);
  }
};

const handlePermissionCallback = async (input: {
  raw: string;
  adminId: number;
  backendUrl: string;
  answerCbQuery: (text: string, showAlert?: boolean) => Promise<unknown>;
  editInlineKeyboard: () => Promise<unknown>;
  sendReply: (text: string) => Promise<unknown>;
}): Promise<void> => {
  /* Route permission approval decision to backend and clear inline keyboard on success. */
  const parts = input.raw.split("|");
  const permissionToken = parts[1] ?? "";
  const responseValue = String(parts[2] ?? "").trim() as OpenCodePermissionResponse;
  if (!permissionToken || !PERMISSION_RESPONSES.includes(responseValue)) {
    await input.answerCbQuery("Некорректный выбор", true);
    return;
  }

  const response = await fetch(`${input.backendUrl}/api/telegram/permission/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-id": String(input.adminId)
    },
    body: JSON.stringify({ permissionToken, response: responseValue })
  });

  if (!response.ok) {
    const text = await response.text();
    await input.answerCbQuery("Не удалось применить решение", true);
    await input.sendReply(`Ошибка подтверждения прав OpenCode: ${text}`);
    return;
  }

  const payload = (await response.json()) as { selected?: string };
  await input.answerCbQuery("Решение отправлено");
  await input.editInlineKeyboard();
  if (payload.selected) {
    await input.sendReply(`Решение по доступу: ${payload.selected}`);
  }
};
