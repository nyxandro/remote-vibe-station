/**
 * @fileoverview Syntax highlighting helpers for file previews.
 *
 * Exports:
 * - highlightToHtml (L27) - Converts code into themed HTML using Shiki.
 */

import {
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
  type ThemeRegistration
} from "shiki";

/*
 * We lazily create a single highlighter instance.
 * Shiki loads grammar/theme assets, so we keep it cached across renders.
 */
let cached: Highlighter | null = null;

const THEME: ThemeRegistration = "vitesse-dark";

const extToLang: Record<string, BundledLanguage> = {
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  json: "json",
  yml: "yaml",
  yaml: "yaml",
  css: "css",
  scss: "scss",
  md: "markdown",
  sh: "bash",
  env: "dotenv",
  py: "python",
  go: "go",
  rs: "rust",
  html: "html"
};

const guessLang = (filePath: string): BundledLanguage | null => {
  /* Best-effort language guess from file extension. */
  const lower = filePath.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() ?? "" : "";
  return extToLang[ext] ?? null;
};

export const highlightToHtml = async (code: string, filePath: string): Promise<string> => {
  /* Convert code to HTML for safe innerHTML rendering. */
  if (!cached) {
    cached = await createHighlighter({ themes: [THEME], langs: Object.values(extToLang) });
  }

  const lang = guessLang(filePath) ?? "text";
  return cached.codeToHtml(code, { lang, theme: THEME });
};
