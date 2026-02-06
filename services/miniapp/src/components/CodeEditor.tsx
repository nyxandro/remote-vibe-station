/**
 * @fileoverview Lightweight CodeMirror wrapper for editing markdown/json/text.
 *
 * Exports:
 * - CodeEditor (L24) - Mobile-friendly editor with language-aware extensions.
 */

import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";

type Props = {
  value: string;
  language: "markdown" | "json" | "text";
  onChange: (value: string) => void;
};

export const CodeEditor = (props: Props) => {
  /* Keep extension selection explicit to avoid incorrect parser setup. */
  const extensions =
    props.language === "json" ? [json()] : props.language === "markdown" ? [markdown()] : [];

  return (
    <CodeMirror
      value={props.value}
      height="220px"
      basicSetup={{ lineNumbers: true, foldGutter: false }}
      extensions={extensions}
      onChange={props.onChange}
      theme="dark"
    />
  );
};
