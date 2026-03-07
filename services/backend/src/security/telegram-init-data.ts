/**
 * @fileoverview Telegram initData parsing and signature verification.
 *
 * Exports:
 * - HASH_KEY (L14) - Query param key for hash.
 * - NEWLINE (L15) - Separator for data-check-string.
 * - parseInitData (L17) - Parse initData into key/value map.
 * - verifyInitData (L29) - Verify initData signature and freshness using bot token.
 * - extractUserId (L58) - Extract Telegram user id from initData.
 */

import * as crypto from "node:crypto";

const HASH_KEY = "hash";
const NEWLINE = "\n";
const WEB_APP_DATA_KEY = "WebAppData";
const AUTH_DATE_KEY = "auth_date";
const MAX_INIT_DATA_AGE_SECONDS = 15 * 60;

export const parseInitData = (initData: string): Map<string, string> => {
  /* Parse query string into a map. */
  const params = new URLSearchParams(initData);
  const map = new Map<string, string>();

  params.forEach((value, key) => {
    map.set(key, value);
  });

  return map;
};

export const verifyInitData = (initData: string, botToken: string, input?: { nowMs?: number }): boolean => {
  /* Parse and validate presence of hash. */
  const params = parseInitData(initData);
  const receivedHash = params.get(HASH_KEY);
  if (!receivedHash) {
    return false;
  }

  /* Build data-check-string sorted by key. */
  const entries = Array.from(params.entries())
    .filter(([key]) => key !== HASH_KEY)
    .sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries
    .map(([key, value]) => `${key}=${value}`)
    .join(NEWLINE);

  /* Compute Telegram WebApp secret key: HMAC-SHA256("WebAppData", botToken). */
  const secretKey = crypto.createHmac("sha256", WEB_APP_DATA_KEY).update(botToken).digest();
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const receivedHashBuffer = Buffer.from(receivedHash, "utf-8");
  const computedHashBuffer = Buffer.from(computedHash, "utf-8");
  if (
    receivedHashBuffer.length !== computedHashBuffer.length ||
    !crypto.timingSafeEqual(receivedHashBuffer, computedHashBuffer)
  ) {
    return false;
  }

  /* Reject stale initData so captured launch payloads cannot be replayed forever. */
  const authDateRaw = params.get(AUTH_DATE_KEY);
  const authDateSeconds = Number(authDateRaw);
  if (!Number.isFinite(authDateSeconds)) {
    return false;
  }

  const nowSeconds = Math.floor((input?.nowMs ?? Date.now()) / 1000);
  if (authDateSeconds > nowSeconds) {
    return false;
  }

  return nowSeconds - authDateSeconds <= MAX_INIT_DATA_AGE_SECONDS;
};

export const extractUserId = (initData: string): number | null => {
  /* Extract user JSON and parse it. */
  const params = parseInitData(initData);
  const userRaw = params.get("user");
  if (!userRaw) {
    return null;
  }

  /* Parse user JSON and extract id. */
  const parsed = JSON.parse(userRaw) as { id?: number };
  return typeof parsed.id === "number" ? parsed.id : null;
};
