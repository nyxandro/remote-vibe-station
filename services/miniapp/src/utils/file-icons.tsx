/**
 * @fileoverview File icon selection for file explorer.
 *
 * Exports:
 * - iconForFileEntry (L22) - Picks an icon by file extension and kind.
 */

import { FileJson, FileText, FileType, Folder, Settings } from "lucide-react";

export const iconForFileEntry = (name: string, kind: "file" | "dir") => {
  /* Map file entries into a small icon set. */
  if (kind === "dir") {
    return <Folder size={16} className="icon folder" />;
  }

  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() ?? "" : "";

  if (["json", "jsonc", "json5"].includes(ext)) {
    return <FileJson size={16} className="icon json" />;
  }
  if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "php", "css", "scss"].includes(ext)) {
    return <FileType size={16} className="icon code" />;
  }
  if (["env", "yml", "yaml", "toml", "ini"].includes(ext)) {
    return <Settings size={16} className="icon config" />;
  }

  return <FileText size={16} className="icon file" />;
};
