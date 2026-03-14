/**
 * @fileoverview Visual markdown editor with a formatting toolbar.
 *
 * Exports:
 * - VisualMarkdownEditor - Combines CodeEditor with MarkdownToolbar for a rich editing experience.
 */

import { useRef, useCallback } from "react";
import { EditorView } from "@codemirror/view";

import { CodeEditor, CodeEditorRef } from "./CodeEditor";
import { MarkdownCommand, MarkdownToolbar } from "./MarkdownToolbar";
import { ThemeMode } from "../utils/theme";

type Props = {
  value: string;
  themeMode?: ThemeMode;
  placeholder?: string;
  height?: string;
  onChange: (value: string) => void;
};

export const VisualMarkdownEditor = (props: Props) => {
  const editorRef = useRef<CodeEditorRef>(null);

  const handleCommand = useCallback((command: MarkdownCommand) => {
    const view = editorRef.current?.view;
    if (!view) return;

    const { state } = view;
    const { from, to } = state.selection.main;
    const selectedText = state.sliceDoc(from, to);

    let anchorOffset = 0;
    let dispatch = false;
    let changes: { from: number; to: number; insert: string } | null = null;

    switch (command) {
      case "bold":
        changes = { from, to, insert: `**${selectedText}**` };
        anchorOffset = selectedText ? changes.insert.length : 2;
        dispatch = true;
        break;
      case "italic":
        changes = { from, to, insert: `*${selectedText}*` };
        anchorOffset = selectedText ? changes.insert.length : 1;
        dispatch = true;
        break;
      case "heading":
        changes = { from: from, to: from, insert: "### " };
        anchorOffset = changes.insert.length;
        dispatch = true;
        break;
      case "list":
        changes = { from: from, to: from, insert: "\n- " };
        anchorOffset = changes.insert.length;
        dispatch = true;
        break;
      case "checklist":
        changes = { from: from, to: from, insert: "\n- [ ] " };
        anchorOffset = changes.insert.length;
        dispatch = true;
        break;
      case "code":
        changes = { from, to, insert: `\`${selectedText}\`` };
        anchorOffset = selectedText ? changes.insert.length : 1;
        dispatch = true;
        break;
      case "link":
        changes = { from, to, insert: `[${selectedText}](url)` };
        anchorOffset = selectedText ? changes.insert.length : 1;
        dispatch = true;
        break;
    }

    if (dispatch && changes) {
      view.dispatch({
        changes,
        selection: { anchor: from + anchorOffset },
        scrollIntoView: true
      });
      view.focus();
    }
  }, []);

  return (
    <div className="visual-markdown-editor">
      <MarkdownToolbar onCommand={handleCommand} />
      <div className="visual-markdown-editor-content">
        <CodeEditor
          ref={editorRef}
          language="markdown"
          value={props.value}
          themeMode={props.themeMode}
          placeholder={props.placeholder}
          height={props.height ?? "200px"}
          onChange={props.onChange}
        />
      </div>
    </div>
  );
};
