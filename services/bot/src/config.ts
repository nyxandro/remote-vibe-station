/**
 * @fileoverview Bot configuration loader.
 *
 * Exports:
 * - BotConfig (L15) - Validated configuration shape.
 * - HTTPS_PREFIX (L22) - HTTPS scheme prefix.
 * - CSV_SEPARATOR (L23) - CSV delimiter for admin ids.
 * - parseAdminIds (L32) - Parse and validate admin id list.
 * - requireHttps (L52) - Enforce HTTPS public URLs.
 * - loadConfig (L60) - Parse and validate environment.
 */

import { z } from "zod";

export type BotConfig = {
  telegramBotToken: string;
  adminIds: number[];
  backendUrl: string;
  publicBaseUrl: string;
};

const HTTPS_PREFIX = "https://";
const LOCALHOST_PREFIXES = ["http://localhost", "http://127.0.0.1"];
const CSV_SEPARATOR = ",";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  ADMIN_IDS: z.string().min(1),
  BACKEND_URL: z.string().min(1),
  PUBLIC_BASE_URL: z.string().min(1)
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
    publicBaseUrl: requirePublicBaseUrl(env.PUBLIC_BASE_URL, "PUBLIC_BASE_URL")
  };
};
