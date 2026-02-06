/**
 * @fileoverview Auth helpers for Mini App control flows.
 *
 * Exports:
 * - useAuthControl (L18) - Determines whether user can control Telegram stream.
 */

import { useMemo } from "react";

const STORAGE_KEY_WEB_TOKEN = "tvoc.miniapp.webToken";

export const useAuthControl = (): {
  telegramInitData?: string;
  webToken?: string;
  canControlTelegramStream: boolean;
} => {
  /*
   * Determine auth mode:
   * - Telegram Mini App: window.Telegram.WebApp.initData
   * - Browser: signed web token passed via #token=... and persisted.
   */
  return useMemo(() => {
    const telegramInitData = (window as any)?.Telegram?.WebApp?.initData as string | undefined;

    const hashParams = new URLSearchParams(
      window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash
    );
    const hashToken = hashParams.get("token") ?? "";
    const storedToken = localStorage.getItem(STORAGE_KEY_WEB_TOKEN) ?? "";

    if (!storedToken && hashToken) {
      localStorage.setItem(STORAGE_KEY_WEB_TOKEN, hashToken);
    }

    const webToken = storedToken || hashToken || undefined;

    /*
     * Dev convenience:
     * - When running on localhost without Telegram initData, allow stream control.
     * - Backend guard will only derive admin identity if exactly one admin is configured.
     */
    const isLocalHost =
      window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const canControlTelegramStream = Boolean(telegramInitData) || Boolean(webToken) || isLocalHost;

    return { telegramInitData, webToken, canControlTelegramStream };
  }, []);
};
