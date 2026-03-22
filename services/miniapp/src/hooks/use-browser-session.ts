/**
 * @fileoverview Sliding browser-session renewal for Mini App deep links.
 *
 * Exports:
 * - BrowserSessionState - UI-facing browser-session expiry state.
 * - useBrowserSession - Renews browser tokens on real user activity and reports session-end events.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  bootstrapWebTokenFromTelegram,
  BROWSER_SESSION_EXPIRED_EVENT,
  clearStoredWebToken,
  readStoredWebTokenMetadata,
  refreshWebToken
} from "../api/client";
import type { BrowserSessionExpiredDetail } from "../api/client";

const STORAGE_KEY_LAST_ACTIVITY_AT = "tvoc.miniapp.webToken.lastActivityAt";
const ACTIVITY_THROTTLE_MS = 30 * 1000;
const MIN_REFRESH_INTERVAL_MS = 60 * 1000;
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;
const REFRESH_CHECK_INTERVAL_MS = 60 * 1000;
const DEFAULT_SESSION_EXPIRED_MESSAGE =
  "Сеанс завершен. Закрой Mini App и открой его заново из Telegram, чтобы получить новый токен доступа.";

export type BrowserSessionState = {
  isSessionExpired: boolean;
  sessionExpiredMessage: string | null;
};

const readStoredLastActivityAt = (): number | null => {
  /* Stored last-activity timestamp lets refresh logic survive regular page reloads within the same browser tab. */
  const rawValue = sessionStorage.getItem(STORAGE_KEY_LAST_ACTIVITY_AT);
  if (!rawValue) {
    return null;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : null;
};

const persistLastActivityAt = (value: number): void => {
  /* Browser-mode idle timeout must track explicit user interaction, not background polling traffic. */
  sessionStorage.setItem(STORAGE_KEY_LAST_ACTIVITY_AT, String(value));
};

const clearStoredLastActivityAt = (): void => {
  /* Expired or unauthenticated browser sessions should reset idle tracking before the next launch. */
  sessionStorage.removeItem(STORAGE_KEY_LAST_ACTIVITY_AT);
};

export const useBrowserSession = (): BrowserSessionState => {
  const [isSessionExpired, setIsSessionExpired] = useState<boolean>(false);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null);
  const lastActivityAtRef = useRef<number | null>(readStoredLastActivityAt());
  const isBootstrappingRef = useRef<boolean>(false);
  const isRefreshingRef = useRef<boolean>(false);
  const tokenMetaRef = useRef(readStoredWebTokenMetadata());
  const lastRefreshAtRef = useRef<number>(tokenMetaRef.current?.issuedAtMs ?? 0);

  const syncTokenMetadata = useCallback(() => {
    /* Reading current token metadata through one helper keeps event handlers and timers aligned on the same token. */
    const next = readStoredWebTokenMetadata();
    tokenMetaRef.current = next;
    return next;
  }, []);

  const expireSession = useCallback((message?: string) => {
    /* Session-end state blocks the UI until Telegram issues a fresh browser token via a new launch. */
    clearStoredWebToken();
    clearStoredLastActivityAt();
    setIsSessionExpired(true);
    setSessionExpiredMessage(message?.trim().length ? message.trim() : DEFAULT_SESSION_EXPIRED_MESSAGE);
  }, []);

  const syncTokenRefs = useCallback((tokenMeta: { issuedAtMs: number } | null) => {
    /* Token bootstrap/refresh must realign idle and refresh timers to the currently active bearer token. */
    if (!tokenMeta) {
      lastActivityAtRef.current = null;
      lastRefreshAtRef.current = 0;
      clearStoredLastActivityAt();
      return;
    }

    lastActivityAtRef.current = readStoredLastActivityAt() ?? tokenMeta.issuedAtMs;
    lastRefreshAtRef.current = tokenMeta.issuedAtMs;
  }, []);

  const maybeBootstrapFromTelegram = useCallback(async () => {
    /* Telegram-hosted Mini App should exchange initData into bearer auth before the initData freshness window closes. */
    if (isSessionExpired || isBootstrappingRef.current || syncTokenMetadata()) {
      return;
    }

    const initData = (window as any)?.Telegram?.WebApp?.initData as string | undefined;
    if (typeof initData !== "string" || initData.trim().length === 0) {
      return;
    }

    isBootstrappingRef.current = true;
    try {
      await bootstrapWebTokenFromTelegram();
      syncTokenRefs(syncTokenMetadata());
    } catch (error) {
      /* Auth-specific bootstrap failures should block the UI with a session-ended message, while transient errors may retry later. */
      if (
        error instanceof Error &&
        (error.message.includes("Telegram initData signature is invalid") ||
          error.message.includes("APP_WEB_TOKEN_BOOTSTRAP_INIT_DATA_REQUIRED"))
      ) {
        expireSession(error.message);
      }
    } finally {
      isBootstrappingRef.current = false;
    }
  }, [expireSession, isSessionExpired, syncTokenMetadata, syncTokenRefs]);

  const maybeRefresh = useCallback(async () => {
    /* User activity renews the bearer token directly, so idle tabs cannot extend access on their own. */
    const tokenMeta = syncTokenMetadata();
    if (!tokenMeta || isSessionExpired || isRefreshingRef.current) {
      return;
    }

    const nowMs = Date.now();
    if (nowMs >= tokenMeta.expiresAtMs) {
      expireSession();
      return;
    }

    const shouldRefreshBecauseIntervalElapsed = nowMs - lastRefreshAtRef.current >= MIN_REFRESH_INTERVAL_MS;
    const shouldRefreshBecauseTokenIsNearExpiry = tokenMeta.expiresAtMs - nowMs <= REFRESH_THRESHOLD_MS;
    if (!shouldRefreshBecauseIntervalElapsed && !shouldRefreshBecauseTokenIsNearExpiry) {
      return;
    }

    isRefreshingRef.current = true;
    try {
      await refreshWebToken();
      syncTokenRefs(syncTokenMetadata());
    } catch {
      /* Only auth-expiry should end the session; transient refresh failures can retry on the next timer/user action. */
      if (!readStoredWebTokenMetadata()) {
        expireSession();
      }
    } finally {
      isRefreshingRef.current = false;
    }
  }, [expireSession, isSessionExpired, syncTokenMetadata, syncTokenRefs]);

  const recordActivity = useCallback(() => {
    /* User input extends the idle window, but throttling avoids spamming sessionStorage on rapid scroll/typing bursts. */
    const tokenMeta = syncTokenMetadata();
    if (!tokenMeta) {
      if (!isSessionExpired) {
        void maybeBootstrapFromTelegram();
      }
      return;
    }

    if (isSessionExpired) {
      return;
    }

    const nowMs = Date.now();
    const lastActivityAt = lastActivityAtRef.current;
    if (lastActivityAt !== null && nowMs - lastActivityAt < ACTIVITY_THROTTLE_MS) {
      void maybeRefresh();
      return;
    }

    lastActivityAtRef.current = nowMs;
    persistLastActivityAt(nowMs);
    void maybeRefresh();
  }, [isSessionExpired, maybeBootstrapFromTelegram, maybeRefresh, syncTokenMetadata]);

  useEffect(() => {
    /* Existing browser tokens reuse the last recorded interaction time; brand-new tokens start with zero post-issue activity. */
    syncTokenRefs(syncTokenMetadata());
  }, [syncTokenMetadata, syncTokenRefs]);

  useEffect(() => {
    /* Bootstrap once on mount so Telegram Mini App sessions stop relying on expiring initData during normal work. */
    void maybeBootstrapFromTelegram();
  }, [maybeBootstrapFromTelegram]);

  useEffect(() => {
    /* Browser-session expiry can be announced by any failing API call, so the hook subscribes once at the root. */
    const handleSessionExpired = (event: Event) => {
      const detail = (event as CustomEvent<BrowserSessionExpiredDetail>).detail;
      expireSession(detail?.message);
    };

    window.addEventListener(BROWSER_SESSION_EXPIRED_EVENT, handleSessionExpired as EventListener);
    return () => {
      window.removeEventListener(BROWSER_SESSION_EXPIRED_EVENT, handleSessionExpired as EventListener);
    };
  }, [expireSession]);

  useEffect(() => {
    /* Local expiry polling swaps the UI into session-ended state even when the user stops generating API traffic. */
    const timer = window.setInterval(() => {
      const tokenMeta = syncTokenMetadata();
      if (!tokenMeta || isSessionExpired) {
        return;
      }

      if (Date.now() >= tokenMeta.expiresAtMs) {
        expireSession();
      }
    }, REFRESH_CHECK_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [expireSession, isSessionExpired, syncTokenMetadata]);

  useEffect(() => {
    /* Activity listeners stay global because the whole Mini App shell shares one browser bearer token. */
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        recordActivity();
      }
    };

    window.addEventListener("keydown", recordActivity);
    window.addEventListener("pointerdown", recordActivity);
    window.addEventListener("focus", recordActivity);
    window.addEventListener("scroll", recordActivity, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("keydown", recordActivity);
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("focus", recordActivity);
      window.removeEventListener("scroll", recordActivity);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [recordActivity]);

  return useMemo(
    () => ({
      isSessionExpired,
      sessionExpiredMessage
    }),
    [isSessionExpired, sessionExpiredMessage]
  );
};
