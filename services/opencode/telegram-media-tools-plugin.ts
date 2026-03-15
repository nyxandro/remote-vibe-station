/**
 * @fileoverview OpenCode local plugin that lets agents send staged files back to Telegram.
 *
 * Exports:
 * - TelegramMediaToolsPlugin - Registers `telegram_send_media` and `telegram_send_album` tools.
 *
 * Key constructs:
 * - EXCHANGE_OUTGOING_DIR - Shared directory where staged Telegram media is stored.
 * - SEND_MEDIA_DESCRIPTION - LLM-facing contract for single photo/document delivery.
 * - SEND_ALBUM_DESCRIPTION - LLM-facing contract for one Telegram media group.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { type Plugin, tool } from "@opencode-ai/plugin";

const EXCHANGE_ROOT_DIR = "/root/.local/share/opencode/agent-share";
const EXCHANGE_OUTGOING_DIR = path.join(EXCHANGE_ROOT_DIR, "outgoing");
const MAX_ALBUM_ITEMS = 10;
const SEND_MEDIA_DESCRIPTION = [
  "Send one local file to Telegram.",
  "Use sendAs='photo' for compressed chat photo previews.",
  "Use sendAs='document' for original files without Telegram image compression or for non-image documents.",
  "path may point anywhere readable inside the OpenCode container; the tool copies it into the managed Telegram exchange directory before delivery.",
  "The tool always sends back into the Telegram chat bound to the current OpenCode session; it never guesses another recipient."
].join(" ");
const SEND_ALBUM_DESCRIPTION = [
  "Send several local images as one Telegram album (media group).",
  `Provide between 1 and ${MAX_ALBUM_ITEMS} readable image paths.`,
  "Albums are photo-only; use telegram_send_media with sendAs='document' for original files or non-image documents.",
  "path entries may be outside the exchange folder because the tool stages copies automatically before delivery."
].join(" ");

const requireRuntimeConfig = () => {
  /* Fail fast when the plugin is mounted without trusted backend connectivity. */
  const baseUrl = process.env.BACKEND_URL?.trim();
  const token = process.env.BOT_BACKEND_AUTH_TOKEN?.trim();
  if (!baseUrl) {
    throw new Error("BACKEND_URL is required for Telegram media tools");
  }
  if (!token) {
    throw new Error("BOT_BACKEND_AUTH_TOKEN is required for Telegram media tools");
  }
  return { baseUrl, token };
};

const sanitizeBasename = (fileName: string): string => {
  /* Keep operator-friendly filenames while stripping path separators and exotic control bytes. */
  const normalized = path.basename(fileName).replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized.length > 0 ? normalized : "telegram-media.bin";
};

const ensureReadableFile = (inputPath: string): { absolutePath: string; displayFileName: string } => {
  /* Tool paths are agent-controlled, so validate existence and regular-file semantics explicitly. */
  const candidate = String(inputPath ?? "").trim();
  if (!candidate) {
    throw new Error("TG_MEDIA_SOURCE_PATH_REQUIRED: path is required.");
  }

  const absolutePath = path.resolve(candidate);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`TG_MEDIA_SOURCE_NOT_FOUND: source file '${candidate}' does not exist.`);
  }

  const stats = fs.statSync(absolutePath);
  if (!stats.isFile()) {
    throw new Error(`TG_MEDIA_SOURCE_INVALID: source path '${candidate}' must be a regular file.`);
  }

  return {
    absolutePath,
    displayFileName: sanitizeBasename(path.basename(absolutePath))
  };
};

const stageFileForTelegram = (inputPath: string): { stagedRelativePath: string; displayFileName: string } => {
  /* Stage each send into the managed outgoing directory so backend cleanup has one bounded namespace. */
  const source = ensureReadableFile(inputPath);
  fs.mkdirSync(EXCHANGE_OUTGOING_DIR, { recursive: true });

  const stagedFileName = `${crypto.randomUUID()}-${source.displayFileName}`;
  const stagedAbsolutePath = path.join(EXCHANGE_OUTGOING_DIR, stagedFileName);
  fs.copyFileSync(source.absolutePath, stagedAbsolutePath);

  return {
    stagedRelativePath: stagedFileName,
    displayFileName: source.displayFileName
  };
};

const postJson = async <T>(apiPath: string, body: unknown): Promise<T | null> => {
  /* All Telegram media tool calls use the same trusted backend helper. */
  const { baseUrl, token } = requireRuntimeConfig();
  const response = await fetch(new URL(apiPath, baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bot-backend-token": token
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text.trim().length > 0 ? text : `Telegram media backend request failed with status ${response.status}`);
  }

  return text.trim().length > 0 ? (JSON.parse(text) as T) : null;
};

export const TelegramMediaToolsPlugin: Plugin = async () => {
  return {
    tool: {
      telegram_send_media: tool({
        description: SEND_MEDIA_DESCRIPTION,
        args: {
          path: tool.schema.string(),
          sendAs: tool.schema.enum(["photo", "document"]),
          caption: tool.schema.string().optional(),
          disableNotification: tool.schema.boolean().optional()
        },
        async execute(args, context) {
          const staged = stageFileForTelegram(args.path);
          const response = await postJson<{ adminId: number; chatId: number; itemIds: string[] }>(
            "/api/telegram/agent-media/send",
            {
              sessionId: context.sessionID,
              stagedRelativePath: staged.stagedRelativePath,
              sendAs: args.sendAs,
              caption: args.caption,
              displayFileName: staged.displayFileName,
              disableNotification: args.disableNotification
            }
          );
          if (!response) {
            throw new Error("TG_MEDIA_BACKEND_EMPTY_RESPONSE: Telegram media backend returned an empty response.");
          }

          return [
            `Queued Telegram ${args.sendAs}.`,
            `adminId: ${response.adminId}`,
            `chatId: ${response.chatId}`,
            `staged: ${path.join(EXCHANGE_OUTGOING_DIR, staged.stagedRelativePath)}`,
            `outboxItemIds: ${response.itemIds.join(", ")}`
          ].join("\n");
        }
      }),

      telegram_send_album: tool({
        description: SEND_ALBUM_DESCRIPTION,
        args: {
          paths: tool.schema.array(tool.schema.string()).min(1).max(MAX_ALBUM_ITEMS),
          caption: tool.schema.string().optional(),
          disableNotification: tool.schema.boolean().optional()
        },
        async execute(args, context) {
          const stagedItems = args.paths.map((candidate) => stageFileForTelegram(candidate));
          const response = await postJson<{ adminId: number; chatId: number; itemIds: string[] }>(
            "/api/telegram/agent-media/send-album",
            {
              sessionId: context.sessionID,
              caption: args.caption,
              disableNotification: args.disableNotification,
              items: stagedItems.map((item) => ({
                stagedRelativePath: item.stagedRelativePath,
                displayFileName: item.displayFileName
              }))
            }
          );
          if (!response) {
            throw new Error("TG_MEDIA_BACKEND_EMPTY_RESPONSE: Telegram media backend returned an empty response.");
          }

          return [
            "Queued Telegram album.",
            `adminId: ${response.adminId}`,
            `chatId: ${response.chatId}`,
            `items: ${stagedItems.length}`,
            `outboxItemIds: ${response.itemIds.join(", ")}`
          ].join("\n");
        }
      })
    }
  };
};
