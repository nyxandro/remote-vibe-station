/**
 * @fileoverview Bot configuration loader.
 *
 * Exports:
 * - BotConfig - Validated configuration shape.
 * - TelegramTransportMode - Supported inbound Telegram delivery modes.
 * - loadConfig - Parse and validate environment.
 *
 * Key constructs:
 * - DEFAULT_TELEGRAM_TRANSPORT_MODE - Runtime default used when env does not specify a mode.
 * - parseAdminIds - Parse and validate admin id list.
 * - requirePublicBaseUrl - Enforce public URL constraints for Telegram/OpenCode surfaces.
 */

import { z } from "zod";

export type BotConfig = {
  telegramBotToken: string;
  adminIds: number[];
  backendUrl: string;
  botBackendAuthToken: string;
  publicBaseUrl: string;
  opencodePublicBaseUrl: string;
  transportMode: TelegramTransportMode;
};

export type TelegramTransportMode = "auto" | "webhook" | "polling";

const HTTPS_PREFIX = "https://";
const LOCALHOST_PREFIXES = ["http://localhost", "http://127.0.0.1"];
const CSV_SEPARATOR = ",";
const DEFAULT_TELEGRAM_TRANSPORT_MODE: TelegramTransportMode = "auto";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  ADMIN_IDS: z.string().min(1),
  BACKEND_URL: z.string().min(1),
  BOT_BACKEND_AUTH_TOKEN: z.string().min(1),
  PUBLIC_BASE_URL: z.string().min(1),
  OPENCODE_PUBLIC_BASE_URL: z.string().min(1),
  TELEGRAM_TRANSPORT_MODE: z.enum(["auto", "webhook", "polling"]).optional()
});

const parseAdminIds = (value: string): number[] => {
  /* Parse and validate admin IDs. */
  const items = value
    .split(CSV_SEPARATOR)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (items.length === 0) {
    throw new Error("ADMIN_IDS must include at least one id");
  }

  return items.map((item) => {
    const parsed = Number(item);
    if (!Number.isFinite(parsed)) {
      throw new Error(`ADMIN_IDS contains invalid value: ${item}`);
    }
    return parsed;
  });
};

const requirePublicBaseUrl = (value: string, name: string): string => {
  /*
   * Enforce HTTPS in real deployments.
   * Allow localhost HTTP for local development (polling mode).
   */
  if (LOCALHOST_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return value;
  }

  if (!value.startsWith(HTTPS_PREFIX)) {
    throw new Error(`${name} must start with ${HTTPS_PREFIX} (or localhost http for dev)`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }

  if (!parsedUrl.hostname) {
    throw new Error(`${name} must include a valid hostname`);
  }

  return value;
};

export const loadConfig = (): BotConfig => {
  /* Validate required environment variables. */
  const env = envSchema.parse(process.env);

  /* Normalize and validate values. */
  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    adminIds: parseAdminIds(env.ADMIN_IDS),
    backendUrl: env.BACKEND_URL,
    botBackendAuthToken: env.BOT_BACKEND_AUTH_TOKEN,
    publicBaseUrl: requirePublicBaseUrl(env.PUBLIC_BASE_URL, "PUBLIC_BASE_URL"),
    opencodePublicBaseUrl: requirePublicBaseUrl(
      env.OPENCODE_PUBLIC_BASE_URL,
      "OPENCODE_PUBLIC_BASE_URL"
    ),
    transportMode: env.TELEGRAM_TRANSPORT_MODE ?? DEFAULT_TELEGRAM_TRANSPORT_MODE
  };
};
