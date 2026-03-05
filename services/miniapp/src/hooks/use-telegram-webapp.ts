/**
 * @fileoverview Telegram WebApp bootstrap hook for Mini App runtime.
 *
 * Exports:
 * - useTelegramWebApp (function) - Initializes Telegram WebApp bridge if present.
 */

import { useEffect } from "react";

type TelegramWebAppBridge = {
  ready?: () => void;
  expand?: () => void;
};

export const useTelegramWebApp = (): void => {
  useEffect(() => {
    /* Bootstrap Telegram bridge once so initData and viewport are initialized. */
    const bridge = (window as any)?.Telegram?.WebApp as TelegramWebAppBridge | undefined;
    if (!bridge) {
      return;
    }

    /* Signal readiness to Telegram host and request expanded viewport. */
    bridge.ready?.();
    bridge.expand?.();
  }, []);
};
