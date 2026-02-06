/**
 * @fileoverview Environment parsing and configuration validation.
 *
 * Exports:
 * - DEFAULT_EVENT_BUFFER_SIZE (L16) - Default buffer size for events.
 * - parseAdminIds (L33) - Parse and validate admin id list.
 * - requireHttpsUrl (L55) - Enforce HTTPS public URLs.
 * - parseOptionalNumber (L69) - Parse optional numeric values.
 * - loadConfig (L81) - Load and validate config from environment.
 */

import { z } from "zod";

import { AppConfig } from "./config.types";

const DEFAULT_EVENT_BUFFER_SIZE = 200;
const DEFAULT_WARM_RECENTS_LIMIT = 50;
const CSV_SEPARATOR = ",";
const HTTPS_PREFIX = "https://";
const LOCAL_HTTP_PREFIXES = ["http://localhost", "http://127.0.0.1"];

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_MINIAPP_SHORT_NAME: z.string().optional(),
  ADMIN_IDS: z.string().min(1),
  PUBLIC_BASE_URL: z.string().min(1),
  PUBLIC_DOMAIN: z.string().min(1),
  PROJECTS_ROOT: z.string().min(1),
  OPENCODE_DATA_DIR: z.string().optional(),
  OPENCODE_CONFIG_DIR: z.string().optional(),
  OPENCODE_SYNC_ON_START: z.string().optional(),
  OPENCODE_WARM_RECENTS_ON_START: z.string().optional(),
  OPENCODE_WARM_RECENTS_LIMIT: z.string().optional(),
  OPENCODE_DEFAULT_PROVIDER_ID: z.string().optional(),
  OPENCODE_DEFAULT_MODEL_ID: z.string().optional(),
  OPENCODE_SERVER_URL: z.string().min(1),
  OPENCODE_SERVER_PASSWORD: z.string().optional(),
  OPENCODE_SERVER_USERNAME: z.string().optional(),
  EVENT_BUFFER_SIZE: z.string().optional()
});

const parseOptionalBoolean = (value?: string): boolean | undefined => {
  /* Parse optional boolean values from strings. */
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean value: ${value}`);
};

const parseAdminIds = (value: string): number[] => {
  /* Parse CSV and validate numeric IDs. */
  const items = value
    .split(CSV_SEPARATOR)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  /* Reject empty admin list. */
  if (items.length === 0) {
    throw new Error("ADMIN_IDS must include at least one id");
  }

  /* Convert to numbers and validate. */
  return items.map((item) => {
    const parsed = Number(item);
    if (!Number.isFinite(parsed)) {
      throw new Error(`ADMIN_IDS contains invalid value: ${item}`);
    }
    return parsed;
  });
};

const requireHttpsUrl = (value: string, name: string): string => {
  /* Enforce HTTPS URLs for public endpoints. */
  if (value.startsWith(HTTPS_PREFIX)) {
    return value;
  }

  const isLocal = LOCAL_HTTP_PREFIXES.some((prefix) => value.startsWith(prefix));
  if (isLocal) {
    return value;
  }

  throw new Error(`${name} must start with ${HTTPS_PREFIX}`);
};

const parseOptionalNumber = (value?: string): number | undefined => {
  /* Parse optional numeric values. */
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`EVENT_BUFFER_SIZE must be a number: ${value}`);
  }
  return parsed;
};

export const loadConfig = (): AppConfig => {
  /* Validate required environment variables. */
  const env = envSchema.parse(process.env);

  /* Normalize and validate individual fields. */
  const adminIds = parseAdminIds(env.ADMIN_IDS);
  const publicBaseUrl = requireHttpsUrl(env.PUBLIC_BASE_URL, "PUBLIC_BASE_URL");
  const publicDomain = env.PUBLIC_DOMAIN.trim();
  const eventBufferSize =
    parseOptionalNumber(env.EVENT_BUFFER_SIZE) ?? DEFAULT_EVENT_BUFFER_SIZE;

  /* Default to sync on start only when OPENCODE_DATA_DIR is provided. */
  const opencodeSyncOnStart =
    parseOptionalBoolean(env.OPENCODE_SYNC_ON_START) ?? Boolean(env.OPENCODE_DATA_DIR);

  const opencodeWarmRecentsOnStart =
    parseOptionalBoolean(env.OPENCODE_WARM_RECENTS_ON_START) ?? false;

  const opencodeWarmRecentsLimit =
    parseOptionalNumber(env.OPENCODE_WARM_RECENTS_LIMIT) ?? DEFAULT_WARM_RECENTS_LIMIT;

  /* Optional explicit model override. */
  const opencodeDefaultProviderId = env.OPENCODE_DEFAULT_PROVIDER_ID;
  const opencodeDefaultModelId = env.OPENCODE_DEFAULT_MODEL_ID;
  if ((opencodeDefaultProviderId && !opencodeDefaultModelId) || (!opencodeDefaultProviderId && opencodeDefaultModelId)) {
    throw new Error("OPENCODE_DEFAULT_PROVIDER_ID and OPENCODE_DEFAULT_MODEL_ID must be set together");
  }

  /* Enforce OpenCode auth invariants. */
  if (env.OPENCODE_SERVER_PASSWORD && !env.OPENCODE_SERVER_USERNAME) {
    throw new Error("OPENCODE_SERVER_USERNAME required when password is set");
  }

  /* Assemble config object. */
  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramMiniappShortName: env.TELEGRAM_MINIAPP_SHORT_NAME,
    adminIds,
    publicBaseUrl,
    publicDomain,
    projectsRoot: env.PROJECTS_ROOT,
    opencodeDataDir: env.OPENCODE_DATA_DIR,
    opencodeConfigDir: env.OPENCODE_CONFIG_DIR,
    opencodeSyncOnStart,
    opencodeWarmRecentsOnStart,
    opencodeWarmRecentsLimit,
    opencodeDefaultProviderId,
    opencodeDefaultModelId,
    opencodeServerUrl: env.OPENCODE_SERVER_URL,
    opencodeServerPassword: env.OPENCODE_SERVER_PASSWORD,
    opencodeServerUsername: env.OPENCODE_SERVER_USERNAME,
    eventBufferSize
  };
};

export { DEFAULT_EVENT_BUFFER_SIZE };
