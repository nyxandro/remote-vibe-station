/**
 * @fileoverview Readiness gate for Mini App backend availability.
 *
 * Exports:
 * - MiniAppReadinessState (L12) - Readiness result shape for UI blocking.
 * - useMiniAppReadiness (L36) - Probes backend and reports blocking state.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiGet } from "../api/client";

export type MiniAppReadinessState = {
  isReady: boolean;
  isChecking: boolean;
  blockReason: string | null;
  retryNow: () => void;
};

const POLL_INTERVAL_MS = 7000;
const UNAVAILABLE_MESSAGE =
  "Mini App временно недоступен: нет связи с backend. Проверь контейнеры и сеть, затем повтори.";
const AUTH_HINT_MESSAGE =
  "Mini App требует Telegram initData. Открой приложение из кнопки в Telegram, а не по обычной ссылке браузера.";
const INIT_DATA_EXPIRED_MESSAGE =
  "Mini App требует свежий запуск из Telegram. Закрой приложение и открой его заново из кнопки бота.";

const normalizeErrorMessage = (error: unknown): string => {
  /* Keep technical reason visible to speed up incident triage. */
  if (error instanceof Error && error.message.trim().length > 0) {
    /* Distinguish auth failures to make Telegram launch requirements explicit. */
    if (
      error.message.includes("401") &&
      (error.message.includes("Missing authentication") || error.message.includes("Authentication is missing or invalid"))
    ) {
      return `${AUTH_HINT_MESSAGE}\n\n${error.message}`;
    }
    if (error.message.includes("401") && error.message.includes("Telegram initData signature is invalid")) {
      return `${INIT_DATA_EXPIRED_MESSAGE}\n\n${error.message}`;
    }
    return `${UNAVAILABLE_MESSAGE}\n\n${error.message}`;
  }
  return UNAVAILABLE_MESSAGE;
};

export const useMiniAppReadiness = (): MiniAppReadinessState => {
  const [isReady, setIsReady] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(true);
  const [blockReason, setBlockReason] = useState<string | null>(null);
  const [probeTick, setProbeTick] = useState<number>(0);

  const probe = useCallback(async (): Promise<void> => {
    /* Probe a lightweight endpoint used by the workspace startup flow. */
    setIsChecking(true);
    try {
      await apiGet<unknown>("/api/projects/active");
      setIsReady(true);
      setBlockReason(null);
    } catch (error) {
      setIsReady(false);
      setBlockReason(normalizeErrorMessage(error));
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    /* Execute immediate probe on mount and after user-triggered retry. */
    void probe();
  }, [probe, probeTick]);

  useEffect(() => {
    /* Keep checking periodically so the UI auto-recovers after infra restarts. */
    const timer = window.setInterval(() => {
      void probe();
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [probe]);

  return useMemo(
    () => ({
      isReady,
      isChecking,
      blockReason,
      retryNow: () => {
        /* Manual retry bumps probe tick; no hidden fallbacks involved. */
        setProbeTick((value) => value + 1);
      }
    }),
    [blockReason, isChecking, isReady]
  );
};
