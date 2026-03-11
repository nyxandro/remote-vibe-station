/**
 * @fileoverview Shared file-extension to editor-language inference.
 *
 * Exports:
 * - TextEditorLanguage - Supported CodeMirror language subset in fullscreen readers/editors.
 * - inferTextEditorLanguage - Maps file paths to JSON/Markdown/Text editor modes.
 */

export type TextEditorLanguage = "markdown" | "json" | "text";

const JSON_SUFFIX = ".json";
const MARKDOWN_SUFFIXES = [".md", ".markdown"];

export const inferTextEditorLanguage = (filePath: string): TextEditorLanguage => {
  /* Editor language stays intentionally narrow because Mini App only configures JSON/Markdown explicitly. */
  const normalized = filePath.trim().toLowerCase();
  if (normalized.endsWith(JSON_SUFFIX)) {
    return "json";
  }

  if (MARKDOWN_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return "markdown";
  }

  return "text";
};
