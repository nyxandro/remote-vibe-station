/**
 * @fileoverview Settings accordion for Telegram voice-control configuration.
 *
 * Exports:
 * - VoiceControlSettingsSection - Renders Groq API key/model controls inside Settings tab.
 */

import { VoiceControlSettings } from "../types";

type Props = {
  voiceControl?: {
    apiKey: string;
    hasApiKey: boolean;
    model: VoiceControlSettings["model"];
    supportedModels: VoiceControlSettings["supportedModels"];
    isLoading: boolean;
    isSaving: boolean;
  };
  onVoiceControlApiKeyChange?: (value: string) => void;
  onVoiceControlModelChange?: (value: VoiceControlSettings["model"]) => void;
  onReloadVoiceControl?: () => void;
  onSaveVoiceControl?: () => void;
};

export const VoiceControlSettingsSection = (props: Props) => {
  return (
    <details className="settings-accordion-item">
      <summary>7. Голосовое управление</summary>
      <div className="settings-accordion-body">
        {props.voiceControl ? (
          <>
            {/* The browser must never receive the stored Groq key; blank input means "keep unchanged" until edited. */}
            {props.voiceControl.hasApiKey ? (
              <div className="settings-save-status" aria-live="polite">
                <span className="settings-save-dot" /> Ключ Groq сохранен на сервере и не раскрывается в UI.
              </div>
            ) : null}

            <input
              aria-label="Groq API key"
              className="input settings-input-compact"
              type="password"
              autoComplete="new-password"
              placeholder="Groq API key (gsk_...)"
              value={props.voiceControl.apiKey}
              onChange={(event) => props.onVoiceControlApiKeyChange?.(event.target.value)}
            />

            <select
              aria-label="Voice control model"
              className="input settings-input-compact"
              value={props.voiceControl.model ?? ""}
              onChange={(event) => {
                const value = event.target.value.trim();
                props.onVoiceControlModelChange?.(
                  value.length > 0 ? (value as VoiceControlSettings["model"]) : null
                );
              }}
            >
              <option value="">Select model</option>
              {props.voiceControl.supportedModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>

            <div className="settings-actions-grid">
              <button
                className="btn outline"
                onClick={props.onReloadVoiceControl}
                disabled={props.voiceControl.isLoading}
                type="button"
              >
                {props.voiceControl.isLoading ? "Loading..." : "Reload voice settings"}
              </button>
              <button
                className={props.voiceControl.isSaving ? "btn primary settings-save-btn is-busy" : "btn primary settings-save-btn"}
                onClick={props.onSaveVoiceControl}
                disabled={props.voiceControl.isSaving}
                type="button"
              >
                {props.voiceControl.isSaving ? "Saving..." : "Save voice settings"}
              </button>
            </div>

            {props.voiceControl.isSaving ? (
              <div className="settings-save-status" aria-live="polite">
                <span className="settings-save-dot" /> Сохраняем настройки...
              </div>
            ) : null}
          </>
        ) : (
          <div className="placeholder">Voice settings are available only in Telegram Mini App context.</div>
        )}
      </div>
    </details>
  );
};
