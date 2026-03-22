/**
 * @fileoverview Telegram stream state/actions for the workspace header.
 *
 * Exports:
 * - useTelegramStreamControl - Loads, starts, and stops the Telegram stream for the current admin.
 */

import { useCallback, useEffect, useState } from "react";

import { apiGet, apiPost } from "../api/client";

export const useTelegramStreamControl = (
  setError: (value: string | null) => void,
  canControlTelegramStream: boolean
) => {
  const [telegramStreamEnabled, setTelegramStreamEnabled] = useState<boolean>(false);

  const startTelegramChat = useCallback(async (): Promise<void> => {
    /* Explicit start action keeps header controls aligned with the persisted backend stream switch. */
    try {
      setError(null);
      await apiPost("/api/telegram/stream/start", {});
      setTelegramStreamEnabled(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to start Telegram stream");
    }
  }, [setError]);

  const endTelegramChat = useCallback(async (): Promise<void> => {
    /* Stop action mirrors backend state immediately so UI does not look stuck after success. */
    try {
      setError(null);
      await apiPost("/api/telegram/stream/stop", {});
      setTelegramStreamEnabled(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to stop Telegram stream");
    }
  }, [setError]);

  useEffect(() => {
    /* Losing auth capability should always collapse the stream toggle back to a safe disabled state. */
    if (!canControlTelegramStream) {
      setTelegramStreamEnabled(false);
    }
  }, [canControlTelegramStream]);

  useEffect(() => {
    /* Header bootstraps its current state from backend so browser refreshes do not desync the toggle. */
    if (!canControlTelegramStream) {
      return;
    }

    let isActive = true;

    void (async () => {
      try {
        const record = await apiGet<{ streamEnabled?: boolean } | null>("/api/telegram/stream/status");
        if (isActive) {
          setTelegramStreamEnabled(Boolean(record?.streamEnabled));
        }
      } catch {
        /* Stream status remains best-effort so temporary backend hiccups do not block the whole shell. */
      }
    })();

    return () => {
      /* Late async status reads must not update state after the header has already unmounted. */
      isActive = false;
    };
  }, [canControlTelegramStream]);

  return {
    telegramStreamEnabled,
    startTelegramChat,
    endTelegramChat
  };
};
