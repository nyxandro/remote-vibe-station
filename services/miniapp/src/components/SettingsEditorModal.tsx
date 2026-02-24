/**
 * @fileoverview Fullscreen settings editor modal with save feedback and editor status bar.
 *
 * Exports:
 * - SettingsEditorModal (L39) - Rich editing modal for AGENTS/config/env files.
 */

import { ThemeMode } from "../utils/theme";
import { CodeEditor } from "./CodeEditor";

type Props = {
  isOpen: boolean;
  filePath: string;
  language: "markdown" | "json" | "text";
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
  if (!props.isOpen) {
    return null;
  }

  return (
    <div className="settings-editor-modal-backdrop" onClick={props.onClose} role="presentation">
      <div className="settings-editor-modal" onClick={(event) => event.stopPropagation()}>
        <div className="settings-editor-modal-header">
          <div className="settings-editor-header-meta">
            <div className="settings-editor-meta">{props.filePath}</div>
            <div className="settings-editor-language">{props.language.toUpperCase()}</div>
          </div>
          <button className="btn outline" onClick={props.onClose} type="button">
            Close
          </button>
        </div>

        <div className="settings-editor-modal-body">
          <CodeEditor
            value={props.draft}
            language={props.language}
            height="100%"
            themeMode={props.themeMode}
            autoFocus
            onSaveShortcut={props.onSave}
            onChange={props.onChange}
          />
        </div>

        <div className="settings-editor-modal-footer">
          <div className={props.saveResult === "error" ? "settings-editor-status error" : "settings-editor-status"}>
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
              className={props.isSaving ? "btn primary settings-save-btn is-busy" : "btn primary"}
              onClick={props.onSave}
              disabled={props.isSaving}
              type="button"
            >
              {props.isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
