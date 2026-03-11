/**
 * @fileoverview Shared fullscreen code-reading/editing modal shell.
 *
 * Exports:
 * - FullscreenCodeModal - Reusable fullscreen wrapper for settings editors and file previews.
 */

import { ReactNode, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

import { ThemeMode } from "../utils/theme";
import { TextEditorLanguage } from "../utils/text-editor-language";
import { CodeEditor } from "./CodeEditor";

type Props = {
  isOpen: boolean;
  filePath: string;
  language: TextEditorLanguage;
  themeMode: ThemeMode;
  value: string;
  readOnly?: boolean;
  autoFocus?: boolean;
  headerActions?: ReactNode;
  footer?: ReactNode;
  onChange: (value: string) => void;
  onClose: () => void;
  onSaveShortcut?: () => void;
};

export const FullscreenCodeModal = (props: Props) => {
  const titleId = useId();
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    /* Fullscreen dialogs should trap focus and support Escape consistently across settings and file preview flows. */
    if (!props.isOpen) {
      return;
    }

    const modal = modalRef.current;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal?.focus();

    const getFocusableElements = (): HTMLElement[] => {
      if (!modal) {
        return [];
      }

      return Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        props.onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable = getFocusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        modal?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === modal)) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousActiveElement?.focus();
    };
  }, [props.isOpen, props.onClose]);

  if (!props.isOpen) {
    return null;
  }

  return (
    <div className="settings-editor-modal-backdrop" onClick={props.onClose} role="presentation">
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="settings-editor-modal"
        onClick={(event) => event.stopPropagation()}
        ref={modalRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="settings-editor-modal-header">
          <div className="settings-editor-header-meta">
            <div className="settings-editor-language-badge">{props.language.toUpperCase()}</div>
            <div id={titleId} className="settings-editor-meta">
              {props.filePath}
            </div>
          </div>

          <div className="settings-editor-actions">
            {props.headerActions}
            <button className="btn outline btn-icon" onClick={props.onClose} type="button" title="Close">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Use calc() because height: 100% does not propagate through nested editor DOM on mobile WebViews. */}
        <div className="settings-editor-modal-body">
          <CodeEditor
            autoFocus={props.autoFocus}
            height="calc(100dvh - 90px)"
            language={props.language}
            onChange={props.onChange}
            onSaveShortcut={props.onSaveShortcut}
            readOnly={props.readOnly}
            themeMode={props.themeMode}
            value={props.value}
          />
        </div>

        {props.footer ? <div className="settings-editor-modal-footer">{props.footer}</div> : null}
      </div>
    </div>
  );
};
