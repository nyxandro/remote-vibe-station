/**
 * @fileoverview Types for Telegram execution preferences.
 *
 * Exports:
 * - SelectedModel (L10) - Concrete provider/model pair selected by admin.
 * - AdminPreferences (L15) - Persisted per-admin preferences.
 * - GroqTranscriptionModel (L15) - Supported Groq transcription models.
 * - VoiceControlSettings (L20) - Persisted Groq voice control configuration.
 * - AdminPreferences (L26) - Persisted per-admin preferences.
 * - SettingsSnapshot (L36) - Full settings payload for Telegram UI.
 * - VoiceControlSettingsSnapshot (L47) - Voice settings payload for bot/miniapp.
 */

export type SelectedModel = {
  providerID: string;
  modelID: string;
};

export const GROQ_TRANSCRIPTION_MODELS = ["whisper-large-v3-turbo", "whisper-large-v3"] as const;

export type GroqTranscriptionModel = (typeof GROQ_TRANSCRIPTION_MODELS)[number];

export type VoiceControlSettings = {
  groqApiKey: string | null;
  model: GroqTranscriptionModel | null;
};

export type AdminPreferences = {
  model?: SelectedModel;
  thinking?: string | null;
  agent?: string | null;
  voiceControl?: VoiceControlSettings;
};

export type SettingsSnapshot = {
  selected: {
    model: SelectedModel;
    thinking: string | null;
    agent: string | null;
  };
  providers: Array<{ id: string; name: string; connected: boolean; defaultModelID?: string }>;
  models: Array<{ id: string; name: string; variants: string[] }>;
  agents: Array<{ name: string; description?: string; mode?: string }>;
  thinkingOptions: string[];
};

export type VoiceControlSettingsSnapshot = {
  enabled: boolean;
  apiKey: string | null;
  model: GroqTranscriptionModel | null;
  supportedModels: GroqTranscriptionModel[];
};
