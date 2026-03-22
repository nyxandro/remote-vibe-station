/**
 * @fileoverview Structured error helpers for TelegramController HTTP endpoints.
 *
 * Exports:
 * - requireTelegramAdminId - Resolves Telegram/admin identity or throws structured error.
 * - createTelegramControllerBadRequest - Wraps normalized app-error payload into BadRequestException.
 * - telegramPromptContentRequiredError - Missing text/attachment payload error.
 * - telegramChatIdRequiredError - Missing chat id error.
 * - telegramProviderIdRequiredError - Missing provider id error.
 * - telegramCommandRequiredError - Missing command payload error.
 * - telegramQuestionReplyRequiredError - Missing question reply payload error.
 * - telegramPermissionReplyRequiredError - Missing permission reply payload error.
 * - telegramAdminChatRequiredError - Missing adminId/chatId body error.
 * - telegramDiffPreviewTokenRequiredError - Missing diff preview token error.
 * - telegramDiffPreviewNotFoundError - Missing or unauthorized diff preview error.
 */

import { BadRequestException } from "@nestjs/common";
import { Request } from "express";

import { createAppErrorBody, normalizeUnknownErrorToAppError } from "../logging/app-error";

export const requireTelegramAdminId = (req: Request): number => {
  /* Telegram and bot endpoints rely on resolved admin identity instead of inferring it deeper in services. */
  const adminId = (req as any).authAdminId as number | undefined;
  if (!adminId) {
    throw new BadRequestException(
      createAppErrorBody({
        code: "APP_TELEGRAM_ADMIN_REQUIRED",
        message: "Admin identity is required for Telegram endpoint.",
        hint: "Authenticate as an allowed admin before calling this Telegram API route."
      })
    );
  }

  return adminId;
};

export const createTelegramControllerBadRequest = (input: {
  error: unknown;
  fallbackCode: string;
  fallbackMessage: string;
  fallbackHint: string;
}): BadRequestException => {
  /* Shared catch helper keeps Telegram controller errors aligned with the backend error contract. */
  return new BadRequestException(
    normalizeUnknownErrorToAppError({
      error: input.error,
      fallbackCode: input.fallbackCode,
      fallbackMessage: input.fallbackMessage,
      fallbackHint: input.fallbackHint
    })
  );
};

export const telegramPromptContentRequiredError = (): BadRequestException => {
  /* Prompt enqueue must have either normalized text or supported attachments. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_TELEGRAM_PROMPT_CONTENT_REQUIRED",
      message: "Prompt text or supported attachment is required.",
      hint: "Send prompt text, photo or document attachment before retrying the request."
    })
  );
};

export const telegramChatIdRequiredError = (): BadRequestException => {
  /* Chat binding stays explicit because prompt queueing and stream routing are chat-scoped. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_TELEGRAM_CHAT_ID_REQUIRED",
      message: "Telegram chat id is required.",
      hint: "Provide a numeric chatId and retry the Telegram request."
    })
  );
};

export const telegramProviderIdRequiredError = (): BadRequestException => {
  /* Provider model listing cannot proceed without an explicit provider id. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_TELEGRAM_PROVIDER_ID_REQUIRED",
      message: "Provider id is required.",
      hint: "Choose one provider id and retry loading provider models."
    })
  );
};

export const telegramCommandRequiredError = (): BadRequestException => {
  /* Slash command execution requires one normalized command string. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_TELEGRAM_COMMAND_REQUIRED",
      message: "Telegram command is required.",
      hint: "Provide one command name and retry the command execution request."
    })
  );
};

export const telegramQuestionReplyRequiredError = (): BadRequestException => {
  /* Question replies must include token, step index and selected option index. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_TELEGRAM_QUESTION_REPLY_REQUIRED",
      message: "Question token, question index and option index are required.",
      hint: "Use a fresh question callback payload and retry the answer."
    })
  );
};

export const telegramPermissionReplyRequiredError = (): BadRequestException => {
  /* Permission reply must include one known token plus one valid permission response. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_TELEGRAM_PERMISSION_REPLY_REQUIRED",
      message: "Permission token and valid response are required.",
      hint: "Use one of: once, always or reject, then retry the permission reply."
    })
  );
};

export const telegramAdminChatRequiredError = (): BadRequestException => {
  /* Bot stream/bind actions are body-scoped and need both admin and chat identifiers. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_TELEGRAM_ADMIN_CHAT_REQUIRED",
      message: "Telegram adminId and chatId are required.",
      hint: "Provide numeric adminId and chatId values and retry the stream request."
    })
  );
};

export const telegramDiffPreviewTokenRequiredError = (): BadRequestException => {
  /* Deep-link diff preview must never guess token value from route context. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_TELEGRAM_DIFF_PREVIEW_TOKEN_REQUIRED",
      message: "Diff preview token is required.",
      hint: "Open the diff preview using a valid tokenized link and retry."
    })
  );
};

export const telegramDiffPreviewNotFoundError = (): BadRequestException => {
  /* Diff preview tokens are admin-scoped and should fail closed when stale or чужой. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_TELEGRAM_DIFF_PREVIEW_NOT_FOUND",
      message: "Diff preview was not found or access is denied.",
      hint: "Request a new diff preview link and retry from the same admin account."
    })
  );
};
