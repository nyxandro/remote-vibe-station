/**
 * @fileoverview Hook for dedicated CLI/Proxy tab settings management.
 *
 * Exports:
 * - useProxySettings - Loads and saves global proxy profile via backend API.
 */

import { useCallback, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import { ProxyApplyResult, ProxySettingsInput, ProxySettingsSnapshot } from "../types";

export const useProxySettings = (setError: (value: string | null) => void) => {
  const [snapshot, setSnapshot] = useState<ProxySettingsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [applyResult, setApplyResult] = useState<ProxyApplyResult | null>(null);

  const loadSettings = useCallback(async (): Promise<void> => {
    /* Keep dedicated tab state fresh from backend persisted profile. */
    try {
      setError(null);
      setIsLoading(true);
      const data = await apiGet<ProxySettingsSnapshot>("/api/telegram/proxy/settings");
      setSnapshot(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load proxy settings");
    } finally {
      setIsLoading(false);
    }
  }, [setError]);

  const saveSettings = useCallback(
    async (input: ProxySettingsInput): Promise<void> => {
      /* Persist explicit direct/vless mode so runtime config remains auditable. */
      try {
        setError(null);
        setIsSaving(true);
        const data = await apiPost<ProxySettingsSnapshot>("/api/telegram/proxy/settings", input);
        setSnapshot(data);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to save proxy settings");
      } finally {
        setIsSaving(false);
      }
    },
    [setError]
  );

  const applySettings = useCallback(async (): Promise<void> => {
    /* Trigger runtime compose apply command after profile file generation. */
    try {
      setError(null);
      setIsApplying(true);
      const data = await apiPost<ProxyApplyResult>("/api/telegram/proxy/settings/apply", {});
      setApplyResult(data);
      await loadSettings();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to apply proxy runtime");
    } finally {
      setIsApplying(false);
    }
  }, [loadSettings, setError]);

  return {
    snapshot,
    isLoading,
    isSaving,
    isApplying,
    applyResult,
    loadSettings,
    saveSettings,
    applySettings
  };
};
