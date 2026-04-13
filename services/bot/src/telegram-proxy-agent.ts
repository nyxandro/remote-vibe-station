/**
 * @fileoverview Proxy-aware HTTPS agent builder for Telegram Bot API traffic.
 *
 * Exports:
 * - createTelegramProxyAgent - Returns a Telegraf-compatible HTTPS agent when Telegram traffic must use runtime proxy env.
 */

import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";

const { HttpsProxyAgent } = require("https-proxy-agent") as {
  HttpsProxyAgent: new (proxy: string) => HttpsAgent;
};

const TELEGRAM_API_HOST = "api.telegram.org";

export const createTelegramProxyAgent = (): HttpAgent | HttpsAgent => {
  /* Telegram Bot API must honor proxy env explicitly because Telegraf does not route its HTTPS agent through fetchWithOptionalProxy. */
  const proxyUrl = readProxyUrl();
  if (!proxyUrl || isNoProxyHost(TELEGRAM_API_HOST)) {
    return new HttpsAgent({ keepAlive: true });
  }

  return new HttpsProxyAgent(proxyUrl);
};

const readProxyUrl = (): string | null => {
  /* Telegram calls are HTTPS, so prefer HTTPS_PROXY and fall back to HTTP/ALL_PROXY. */
  return normalizeProxyUrl(process.env.HTTPS_PROXY)
    ?? normalizeProxyUrl(process.env.https_proxy)
    ?? normalizeProxyUrl(process.env.HTTP_PROXY)
    ?? normalizeProxyUrl(process.env.http_proxy)
    ?? normalizeProxyUrl(process.env.ALL_PROXY)
    ?? normalizeProxyUrl(process.env.all_proxy);
};

const normalizeProxyUrl = (value: string | undefined): string | null => {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
};

const isNoProxyHost = (hostname: string): boolean => {
  /* Keep Telegram direct only when operator explicitly excluded it from runtime proxy routing. */
  const rawValue = process.env.NO_PROXY ?? process.env.no_proxy;
  const raw = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!raw) {
    return false;
  }

  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") {
        return true;
      }
      if (hostname.toLowerCase() === entry) {
        return true;
      }
      if (entry.startsWith(".")) {
        return hostname.toLowerCase().endsWith(entry);
      }
      return hostname.toLowerCase().endsWith(`.${entry}`);
    });
};
