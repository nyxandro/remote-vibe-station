/**
 * @fileoverview Registration for Telegram prompt, media, and slash-forwarding handlers.
 *
 * Exports:
 * - BotPromptCommandSyncRuntime - Minimal slash-command runtime contract used by text handler.
 * - registerBotPromptHandlers - Wires voice/photo/document/text handlers to backend prompt endpoints.
 */

import { Telegraf } from "telegraf";

import { buildBotBackendHeaders } from "./backend-auth";
import { buildBackendErrorMessage } from "./backend-error";
import { buildCommandQueuedMessage } from "./command-ack";
import { BotConfig } from "./config";
import { ThinkingIndicator } from "./thinking-indicator";
import {
  buildTelegramPromptEnqueueBody,
  extractTelegramImageDocumentInput,
  extractTelegramPhotoInput
} from "./telegram-prompt-input";
import { BOT_LOCAL_COMMAND_NAMES, parseSlashCommand } from "./telegram-commands";
import {
  VOICE_TRANSCRIPTION_NOT_CONFIGURED_MESSAGE,
  VOICE_TRANSCRIPTION_PROGRESS_MESSAGE,
  buildTranscriptionFailureMessage,
  buildTranscriptionSuccessHtml,
  extractTelegramVoiceInput,
  fetchVoiceControlSettings,
  transcribeTelegramAudioWithGroq,
  validateVoiceInput
} from "./voice-control";

const createTelegramPromptTraceId = (adminId: number, chatId: number): string => {
  /* Use one compact identifier across bot/backend logs for the same Telegram turn. */
  return `tg-${adminId}-${chatId}-${Date.now().toString(36)}`;
};

export type BotPromptCommandSyncRuntime = {
  resolveCommandAlias: (command: string) => string | undefined;
  syncSlashCommands: (adminId: number) => Promise<void>;
};

export const registerBotPromptHandlers = (input: {
  bot: Telegraf;
  config: BotConfig;
  indicator: ThinkingIndicator;
  isAdmin: (id: number | undefined) => boolean;
  bindChat: (adminId: number, chatId: number) => Promise<void>;
  commandSyncRuntime: BotPromptCommandSyncRuntime;
}): void => {
  const safeSendMessage = async (
    chatId: number,
    text: string,
    extra?: Parameters<Telegraf["telegram"]["sendMessage"]>[2]
  ): Promise<void> => {
    /* Error-reporting messages are best-effort and must not create second-order failures. */
    try {
      await input.bot.telegram.sendMessage(chatId, text, extra);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Failed to send Telegram message", error);
    }
  };

  const submitPromptText = async (prompt: {
    adminId: number;
    chatId: number;
    payload: Record<string, unknown>;
    errorLabel: string;
  }): Promise<void> => {
    /* Reuse one enqueue flow for text, images, PDFs and transcribed voice so queue semantics stay identical. */
    /* Runtime bridge now owns thinking indicator lifecycle, so bot-side enqueue must not start optimistic typing early. */
    const traceId = createTelegramPromptTraceId(prompt.adminId, prompt.chatId);
    const bindStartedAt = Date.now();
    // eslint-disable-next-line no-console
    console.info("[telegram-trace] bot.prompt.received", {
      traceId,
      adminId: prompt.adminId,
      chatId: prompt.chatId,
      payloadKeys: Object.keys(prompt.payload)
    });

    await input.bindChat(prompt.adminId, prompt.chatId);
    // eslint-disable-next-line no-console
    console.info("[telegram-trace] bot.bind.completed", {
      traceId,
      adminId: prompt.adminId,
      chatId: prompt.chatId,
      durationMs: Date.now() - bindStartedAt
    });

    void (async () => {
      const enqueueStartedAt = Date.now();
      try {
        // eslint-disable-next-line no-console
        console.info("[telegram-trace] bot.enqueue.started", {
          traceId,
          adminId: prompt.adminId,
          chatId: prompt.chatId
        });
        const response = await fetch(`${input.config.backendUrl}/api/telegram/prompt/enqueue`, {
          method: "POST",
          headers: buildBotBackendHeaders(input.config, prompt.adminId, {
            "Content-Type": "application/json"
          }),
          body: JSON.stringify({ chatId: prompt.chatId, traceId, ...prompt.payload })
        });

        // eslint-disable-next-line no-console
        console.info("[telegram-trace] bot.enqueue.completed", {
          traceId,
          adminId: prompt.adminId,
          chatId: prompt.chatId,
          status: response.status,
          durationMs: Date.now() - enqueueStartedAt
        });

        if (!response.ok) {
          const body = await response.text();
          await safeSendMessage(prompt.chatId, buildBackendErrorMessage(response.status, body));
          return;
        }

        const payload = (await response.json()) as {
          ok?: boolean;
          position?: number;
          buffered?: boolean;
          merged?: boolean;
        };

        /* Notify only when the message becomes a new queued item behind another active turn. */
        if (payload.buffered && !payload.merged && typeof payload.position === "number" && payload.position > 1) {
          await safeSendMessage(prompt.chatId, `Сообщение поставлено в очередь: #${payload.position}`, {
            disable_notification: true
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // eslint-disable-next-line no-console
        console.error("[telegram-trace] bot.enqueue.failed", {
          traceId,
          adminId: prompt.adminId,
          chatId: prompt.chatId,
          durationMs: Date.now() - enqueueStartedAt,
          error: message
        });
        await safeSendMessage(prompt.chatId, `${prompt.errorLabel}: ${message}`);
      }
    })();
  };

  input.bot.on("voice", async (ctx) => {
    /* Convert Telegram voice note to text first, then forward it into the same backend prompt queue. */
    if (!input.isAdmin(ctx.from?.id)) {
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
      const settings = await fetchVoiceControlSettings(input.config, adminId);
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
        payload: buildTelegramPromptEnqueueBody({
          text: transcribedText,
          messageId: ctx.message.message_id
        }),
        errorLabel: "Ошибка запроса"
      });
    } catch (error) {
      /* Keep the root cause in logs so operations can distinguish setup issues from runtime API failures. */
      // eslint-disable-next-line no-console
      console.error("Voice transcription failed", error);
      const failureMessage = buildTranscriptionFailureMessage(error);
      if (statusMessageId !== null) {
        await ctx.telegram.editMessageText(chatId, statusMessageId, undefined, failureMessage);
        return;
      }
      await ctx.reply(failureMessage);
    }
  });

  input.bot.on("photo", async (ctx) => {
    /* Forward Telegram photos into the same buffered backend queue used for text prompts. */
    if (!input.isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    const promptBody = extractTelegramPhotoInput(ctx.message);
    if (!promptBody) {
      return;
    }

    await submitPromptText({
      adminId: ctx.from!.id,
      chatId: ctx.chat.id,
      payload: promptBody,
      errorLabel: "Ошибка запроса"
    });
  });

  input.bot.on("document", async (ctx) => {
    /* Support image and PDF documents while failing fast for unsupported generic file uploads. */
    if (!input.isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    const promptBody = extractTelegramImageDocumentInput(ctx.message);
    if (!promptBody) {
      await ctx.reply(
        "Сейчас в чат агента поддерживаются изображения и PDF: photo, document(image/*) или document(application/pdf)."
      );
      return;
    }

    await submitPromptText({
      adminId: ctx.from!.id,
      chatId: ctx.chat.id,
      payload: promptBody,
      errorLabel: "Ошибка запроса"
    });
  });

  input.bot.on("text", async (ctx) => {
    /* Forward free-form prompts and remote slash commands while preserving local bot-owned commands. */
    if (!input.isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    const text = ctx.message.text.trim();
    const adminId = ctx.from!.id;
    const chatId = ctx.chat.id;
    const slash = parseSlashCommand(text);
    if (slash) {
      if (BOT_LOCAL_COMMAND_NAMES.has(slash.command)) {
        return;
      }

      let resolvedCommand = input.commandSyncRuntime.resolveCommandAlias(slash.command);
      if (!resolvedCommand) {
        /* Re-sync once before rejecting to reduce stale-menu race conditions. */
        try {
          await input.commandSyncRuntime.syncSlashCommands(ctx.from!.id);
        } catch {
          /* Sync failure still falls through into the normal unknown-command response. */
        }

        resolvedCommand = input.commandSyncRuntime.resolveCommandAlias(slash.command);
        if (!resolvedCommand) {
          await ctx.reply(`Неизвестная команда: /${slash.command}`);
          return;
        }
      }

      await input.bindChat(adminId, chatId);

      /* Run command call in background to avoid Telegraf middleware timeout while backend keeps working. */
      void (async () => {
        try {
          const commandResponse = await fetch(`${input.config.backendUrl}/api/telegram/command`, {
            method: "POST",
            headers: buildBotBackendHeaders(input.config, adminId, {
              "Content-Type": "application/json"
            }),
            body: JSON.stringify({
              command: resolvedCommand,
              arguments: slash.args
            })
          });

          if (!commandResponse.ok) {
            const body = await commandResponse.text();
            await safeSendMessage(chatId, buildBackendErrorMessage(commandResponse.status, body));
            return;
          }

          await commandResponse.json();
          await safeSendMessage(chatId, buildCommandQueuedMessage(slash.command), {
            disable_notification: true
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await safeSendMessage(chatId, `Ошибка команды: ${message}`);
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
      payload: buildTelegramPromptEnqueueBody({
        text,
        messageId: ctx.message.message_id
      }),
      errorLabel: "Ошибка запроса"
    });
  });
};
