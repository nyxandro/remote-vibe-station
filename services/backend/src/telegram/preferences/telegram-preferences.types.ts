/**
 * @fileoverview Types for Telegram execution preferences.
 *
 * Exports:
 * - SelectedModel (L10) - Concrete provider/model pair selected by admin.
 * - AdminPreferences (L15) - Persisted per-admin preferences.
 * - SettingsSnapshot (L24) - Full settings payload for Telegram UI.
 */

export type SelectedModel = {
  providerID: string;
  modelID: string;
};

export type AdminPreferences = {
  model?: SelectedModel;
  thinking?: string | null;
  agent?: string | null;
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
