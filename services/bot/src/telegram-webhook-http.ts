/**
 * @fileoverview Immediate-ack Telegram webhook middleware for resilient bot delivery.
 *
 * Exports:
 * - TelegramWebhookPayload - Minimal Telegram update shape needed for request logging.
 * - createTelegramWebhookMiddleware - Returns Express middleware that acknowledges Telegram immediately.
 */

import { NextFunction, Request, Response } from "express";
import { Telegraf } from "telegraf";

export type TelegramWebhookPayload = {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number };
    from?: { id?: number };
  };
  callback_query?: {
    id?: string;
    from?: { id?: number };
    message?: { chat?: { id?: number } };
  };
};

type TelegramWebhookRequest = Request & {
  body?: TelegramWebhookPayload;
};

export const createTelegramWebhookMiddleware = (bot: Telegraf) => {
  /* Acknowledge Telegram immediately so webhook delivery does not wait for downstream bot handlers or Bot API calls. */
  return (request: TelegramWebhookRequest, response: Response, next: NextFunction): void => {
    const update = request.body;
    if (!update) {
      next();
      return;
    }

    const messageText = update.message?.text;

    // eslint-disable-next-line no-console
    console.info("Telegram webhook update received", {
      updateId: update.update_id ?? null,
      messageId: update.message?.message_id ?? null,
      textLength: typeof messageText === "string" ? messageText.length : null,
      hasCallbackQuery: Boolean(update.callback_query)
    });

    /* Return 200 before any Telegram/Bot API side effects so Telegram does not retry the same update on slow handlers. */
    response.status(200).end();

    void bot.handleUpdate(update).catch((error) => {
      // eslint-disable-next-line no-console
      console.error("Telegram webhook update handling failed", error);
    });
  };
};
