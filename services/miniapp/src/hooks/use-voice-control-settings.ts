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
  model: VoiceControlSettings["model"];
  supportedModels: VoiceControlSettings["supportedModels"];
  isLoading: boolean;
  isSaving: boolean;
};

export const useVoiceControlSettings = (setError: (value: string | null) => void) => {
  const [state, setState] = useState<VoiceControlFormState>({
    apiKey: "",
    model: null,
    supportedModels: ["whisper-large-v3-turbo", "whisper-large-v3"],
    isLoading: false,
    isSaving: false
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
        apiKey: payload.apiKey ?? "",
        model: payload.model,
        supportedModels:
          supportedModels.length > 0
            ? supportedModels
            : ["whisper-large-v3-turbo", "whisper-large-v3"],
        isLoading: false
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
      setState((prev) => ({ ...prev, isSaving: true }));
      setError(null);

      const payload = await apiPost<VoiceControlSettings>("/api/telegram/voice-control", {
        apiKey: state.apiKey,
        model: state.model
      });
      const supportedModels = Array.isArray(payload.supportedModels) ? payload.supportedModels : [];

      setState((prev) => ({
        ...prev,
        apiKey: payload.apiKey ?? "",
        model: payload.model,
        supportedModels:
          supportedModels.length > 0
            ? supportedModels
            : ["whisper-large-v3-turbo", "whisper-large-v3"],
        isSaving: false
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save voice control settings";
      setState((prev) => ({ ...prev, isSaving: false }));
      setError(message);
    }
  }, [setError, state.apiKey, state.model]);

  return {
    state,
    setApiKey: (value: string) => setState((prev) => ({ ...prev, apiKey: value })),
    setModel: (value: VoiceControlSettings["model"]) => setState((prev) => ({ ...prev, model: value })),
    loadSettings,
    saveSettings
  };
};
