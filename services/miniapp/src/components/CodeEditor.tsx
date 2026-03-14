/**
 * @fileoverview Lightweight CodeMirror wrapper for editing markdown/json/text.
 *
 * Exports:
 * - CodeEditor (L29) - Mobile-friendly editor with language-aware extensions and save shortcut.
 */

import { indentWithTab } from "@codemirror/commands";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { keymap, EditorView } from "@codemirror/view";
import { useMemo } from "react";

import { ThemeMode } from "../utils/theme";

import { useRef, useImperativeHandle, forwardRef } from "react";

export type CodeEditorRef = {
  view: EditorView | null;
};

type Props = {
  value: string;
  language: "markdown" | "json" | "text";
  height?: string;
  themeMode?: ThemeMode;
  autoFocus?: boolean;
  readOnly?: boolean;
  onSaveShortcut?: () => void;
  onChange: (value: string) => void;
};

export const CodeEditor = forwardRef<CodeEditorRef, Props>((props, ref) => {
  const editorRef = useRef<{ view?: EditorView }>(null);

  useImperativeHandle(ref, () => ({
    view: editorRef.current?.view ?? null
  }));
  const extensions = useMemo(() => {
    /* Keep extension selection explicit to avoid incorrect parser setup. */
    const languageExt =
      props.language === "json" ? [json()] : props.language === "markdown" ? [markdown()] : [];

    /* Register editor-like keyboard ergonomics and quick save shortcut. */
    const saveKeymap = keymap.of([
      indentWithTab,
      {
        key: "Mod-s",
        run: () => {
          props.onSaveShortcut?.();
          return true;
        }
      }
    ]);

    return [...languageExt, saveKeymap, EditorView.lineWrapping];
  }, [props.language, props.onSaveShortcut]);

  return (
    <CodeMirror
      ref={editorRef}
      value={props.value}
      height={props.height ?? "220px"}
      autoFocus={props.autoFocus}
      readOnly={props.readOnly}
      basicSetup={{
        lineNumbers: true,
        foldGutter: true,
        highlightActiveLine: true,
        highlightSelectionMatches: true,
        closeBrackets: true,
        searchKeymap: true
      }}
      extensions={extensions}
      onChange={props.onChange}
      theme={props.themeMode === "light" ? "light" : "dark"}
    />
  );
});
