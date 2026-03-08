/**
 * @fileoverview Callback handlers for OpenCode inline actions in Telegram.
 *
 * Exports:
 * - OpenCodePermissionResponse (L12) - Allowed permission decision values.
 * - registerOpenCodeCallbacks (L22) - Registers question/permission callback handler.
 */

import { Telegraf } from "telegraf";

import { buildBotBackendHeaders } from "./backend-auth";
import { BotConfig } from "./config";

export type OpenCodePermissionResponse = "once" | "always" | "reject";

const QUESTION_CALLBACK_PREFIX = "q|";
const PERMISSION_CALLBACK_PREFIX = "perm|";
const PERMISSION_RESPONSES: OpenCodePermissionResponse[] = ["once", "always", "reject"];

const buildQuestionReplyMarkup = (input: { questionToken: string; questionIndex: number; options: string[] }) => ({
  inline_keyboard: input.options.map((label, optionIndex) => [
    {
      text: label,
      callback_data: `${QUESTION_CALLBACK_PREFIX}${input.questionToken}|${input.questionIndex}|${optionIndex}`
    }
  ])
});

export const registerOpenCodeCallbacks = (input: {
  bot: Telegraf;
  config: BotConfig;
  isAdmin: (id: number | undefined) => boolean;
}): void => {
  /* Register callback routes for OpenCode question and permission prompts. */
  input.bot.on("callback_query", async (ctx, next) => {
    const raw = "data" in ctx.callbackQuery ? String(ctx.callbackQuery.data ?? "") : "";
    if (!raw.startsWith(QUESTION_CALLBACK_PREFIX) && !raw.startsWith(PERMISSION_CALLBACK_PREFIX)) {
      /* Let other callback handlers (sessions/mode/...) process non-OpenCode payloads. */
      if (typeof next === "function") {
        await next();
      }
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
        botBackendAuthToken: input.config.botBackendAuthToken,
        answerCbQuery: (text: string, showAlert?: boolean) =>
          ctx.answerCbQuery(text, showAlert ? { show_alert: true } : undefined),
        editQuestionPrompt: (text: string, replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }) =>
          ctx.editMessageText(text, { reply_markup: replyMarkup }),
        editInlineKeyboard: () => ctx.editMessageReplyMarkup({ inline_keyboard: [] }),
        sendReply: (text: string) => ctx.reply(text),
        sendQuestionPrompt: (text: string, replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }) =>
          ctx.reply(text, { reply_markup: replyMarkup })
      });
      return;
    }

    await handlePermissionCallback({
      raw,
      adminId: Number(ctx.from?.id),
      backendUrl: input.config.backendUrl,
      botBackendAuthToken: input.config.botBackendAuthToken,
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
  editQuestionPrompt: (
    text: string,
    replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
  ) => Promise<unknown>;
  editInlineKeyboard: () => Promise<unknown>;
  sendReply: (text: string) => Promise<unknown>;
  sendQuestionPrompt: (
    text: string,
    replyMarkup: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
  ) => Promise<unknown>;
  botBackendAuthToken: string;
}): Promise<void> => {
  /* Route selected question option to backend and clear inline keyboard on success. */
  const parts = input.raw.split("|");
  const questionToken = parts[1] ?? "";
  const hasExplicitQuestionIndex = parts.length >= 4;
  const rawQuestionIndex = hasExplicitQuestionIndex ? String(parts[2] ?? "").trim() : "0";
  const rawOptionIndex = String(hasExplicitQuestionIndex ? parts[3] ?? "" : parts[2] ?? "").trim();
  const questionIndex = rawQuestionIndex.length > 0 ? Number(rawQuestionIndex) : Number.NaN;
  const optionIndex = rawOptionIndex.length > 0 ? Number(rawOptionIndex) : Number.NaN;
  if (!questionToken || !Number.isInteger(questionIndex) || questionIndex < 0 || !Number.isInteger(optionIndex) || optionIndex < 0) {
    await input.answerCbQuery("Некорректный ответ", true);
    return;
  }

  const response = await fetch(`${input.backendUrl}/api/telegram/question/reply`, {
    method: "POST",
    headers: buildBotBackendHeaders(
      { botBackendAuthToken: input.botBackendAuthToken },
      input.adminId,
      { "Content-Type": "application/json" }
    ),
    body: JSON.stringify({ questionToken, questionIndex, optionIndex })
  });

  if (!response.ok) {
    const text = await response.text();
    await input.answerCbQuery("Не удалось отправить ответ", true);
    await input.sendReply(`Ошибка ответа на вопрос OpenCode: ${text}`);
    return;
  }

  const payload = (await response.json()) as {
    selected?: string;
    completed?: boolean;
    nextPrompt?: { text?: string; questionIndex?: number; options?: string[] };
  };
  if (payload.completed === false && payload.nextPrompt?.text && Array.isArray(payload.nextPrompt.options)) {
    const replyMarkup = buildQuestionReplyMarkup({
      questionToken,
      questionIndex: Number(payload.nextPrompt.questionIndex ?? questionIndex + 1),
      options: payload.nextPrompt.options
    });

    await input.answerCbQuery("Ответ принят");
    try {
      await input.editQuestionPrompt(payload.nextPrompt.text, replyMarkup);
    } catch {
      await input.sendQuestionPrompt(payload.nextPrompt.text, replyMarkup);
    }
    return;
  }

  await input.answerCbQuery("Ответ отправлен");
  await input.editInlineKeyboard();
};

const handlePermissionCallback = async (input: {
  raw: string;
  adminId: number;
  backendUrl: string;
  answerCbQuery: (text: string, showAlert?: boolean) => Promise<unknown>;
  editInlineKeyboard: () => Promise<unknown>;
  sendReply: (text: string) => Promise<unknown>;
  botBackendAuthToken: string;
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
    headers: buildBotBackendHeaders(
      { botBackendAuthToken: input.botBackendAuthToken },
      input.adminId,
      { "Content-Type": "application/json" }
    ),
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
