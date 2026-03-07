/**
 * @fileoverview Mini App hook for Telegram voice-control settings.
 *
 * Exports:
 * - VoiceControlFormState (L13) - Local editable state for API key/model form.
 * - useVoiceControlSettings (L20) - Loads and saves Groq voice settings via backend API.
 */

import { useCallback, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import { VoiceControlSettings } from "../types";

export type VoiceControlFormState = {
  apiKey: string;
  hasApiKey: boolean;
  model: VoiceControlSettings["model"];
  supportedModels: VoiceControlSettings["supportedModels"];
  isLoading: boolean;
  isSaving: boolean;
  isApiKeyDirty: boolean;
  saveResult: "idle" | "success" | "error";
};

export const useVoiceControlSettings = (setError: (value: string | null) => void) => {
  const [state, setState] = useState<VoiceControlFormState>({
    apiKey: "",
    hasApiKey: false,
    model: null,
    supportedModels: ["whisper-large-v3-turbo", "whisper-large-v3"],
    isLoading: false,
    isSaving: false,
    isApiKeyDirty: false,
    saveResult: "idle"
  });

  const loadSettings = useCallback(async (): Promise<void> => {
    /* Load current Groq key/model from backend for authenticated Telegram user. */
    try {
      setError(null);
      setState((prev) => ({ ...prev, isLoading: true }));
      const payload = await apiGet<VoiceControlSettings>("/api/telegram/voice-control");
      const supportedModels = Array.isArray(payload.supportedModels) ? payload.supportedModels : [];
      setState((prev) => ({
        ...prev,
        apiKey: "",
        hasApiKey: Boolean(payload.hasApiKey),
        model: payload.model,
        supportedModels:
          supportedModels.length > 0
            ? supportedModels
            : ["whisper-large-v3-turbo", "whisper-large-v3"],
        isLoading: false,
        isApiKeyDirty: false
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load voice control settings";
      setState((prev) => ({ ...prev, isLoading: false }));
      setError(message);
    }
  }, [setError]);

  const saveSettings = useCallback(async (): Promise<void> => {
    /* Persist raw key/model values exactly as provided in the settings form. */
    try {
      setState((prev) => ({ ...prev, isSaving: true, saveResult: "idle" }));
      setError(null);

      /* Prevent accidental deletion of an existing server-side key from a blank password field. */
      const shouldSendApiKey = state.isApiKeyDirty && (!state.hasApiKey || state.apiKey.trim().length > 0);

      const payload = await apiPost<VoiceControlSettings>("/api/telegram/voice-control", {
        ...(shouldSendApiKey ? { apiKey: state.apiKey } : {}),
        model: state.model
      });
      const supportedModels = Array.isArray(payload.supportedModels) ? payload.supportedModels : [];

      setState((prev) => ({
        ...prev,
        apiKey: "",
        hasApiKey: Boolean(payload.hasApiKey),
        model: payload.model,
        supportedModels:
          supportedModels.length > 0
            ? supportedModels
            : ["whisper-large-v3-turbo", "whisper-large-v3"],
        isSaving: false,
        isApiKeyDirty: false,
        saveResult: "success"
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save voice control settings";
      setState((prev) => ({ ...prev, isSaving: false, saveResult: "error" }));
      setError(message);
    }
  }, [setError, state.apiKey, state.isApiKeyDirty, state.model]);

  return {
    state,
    setApiKey: (value: string) =>
      setState((prev) => ({
        ...prev,
        apiKey: value,
        isApiKeyDirty: true,
        saveResult: prev.isSaving ? prev.saveResult : "idle"
      })),
    setModel: (value: VoiceControlSettings["model"]) =>
      setState((prev) => ({ ...prev, model: value, saveResult: prev.isSaving ? prev.saveResult : "idle" })),
    loadSettings,
    saveSettings
  };
};
