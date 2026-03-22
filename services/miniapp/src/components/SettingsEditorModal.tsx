/**
 * @fileoverview Fullscreen settings editor modal with save feedback and editor status bar.
 *
 * Exports:
 * - SettingsEditorModal (L39) - Rich editing modal for AGENTS/config/env files.
 */

import { lazy, Suspense } from "react";

import { ThemeMode } from "../utils/theme";
import { TextEditorLanguage } from "../utils/text-editor-language";

const FullscreenCodeModal = lazy(async () => ({
  default: (await import("./FullscreenCodeModal")).FullscreenCodeModal
}));

type Props = {
  isOpen: boolean;
  filePath: string;
  language: TextEditorLanguage;
  themeMode: ThemeMode;
  draft: string;
  isDirty: boolean;
  isSaving: boolean;
  saveResult: "idle" | "success" | "error";
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
};

const saveStatusLabel = (input: {
  isDirty: boolean;
  isSaving: boolean;
  saveResult: "idle" | "success" | "error";
}): string => {
  /* Keep one deterministic status line so user always knows save state. */
  if (input.isSaving) {
    return "Saving changes...";
  }
  if (input.saveResult === "success" && !input.isDirty) {
    return "All changes saved.";
  }
  if (input.saveResult === "error") {
    return "Save failed. Check network/backend and retry.";
  }
  return input.isDirty ? "Unsaved changes." : "No local changes.";
};

export const SettingsEditorModal = (props: Props) => {
  /* Editor modal is lazy-loaded so the settings tab does not pull CodeMirror until the user actually opens a file. */
  if (!props.isOpen) {
    return null;
  }

  return (
    <Suspense fallback={<div className="placeholder">Loading editor...</div>}>
      <FullscreenCodeModal
        autoFocus
        filePath={props.filePath}
        footer={
          <>
            <div
              className={
                props.saveResult === "error"
                  ? "settings-editor-status error"
                  : "settings-editor-status"
              }
            >
              {saveStatusLabel({
                isDirty: props.isDirty,
                isSaving: props.isSaving,
                saveResult: props.saveResult
              })}
              <span className="settings-editor-shortcut">Ctrl/Cmd+S</span>
            </div>

            <div className="settings-editor-actions">
              <button className="btn outline" onClick={props.onClose} type="button">
                Cancel
              </button>
              <button
                className={
                  props.isSaving
                    ? "btn primary settings-save-btn is-busy"
                    : "btn primary"
                }
                onClick={props.onSave}
                disabled={props.isSaving}
                type="button"
              >
                {props.isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </>
        }
        isOpen
        language={props.language}
        onChange={props.onChange}
        onClose={props.onClose}
        onSaveShortcut={props.onSave}
        themeMode={props.themeMode}
        value={props.draft}
      />
    </Suspense>
  );
};
