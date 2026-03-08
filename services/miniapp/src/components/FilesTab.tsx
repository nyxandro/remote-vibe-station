/**
 * @fileoverview Files tab UI.
 *
 * Exports:
 * - FilesTab (L24) - Renders file tree and syntax-highlighted preview.
 */

import { ArrowUp, RefreshCw, FolderOpen } from "lucide-react";

import { FileListResponse, FileReadResponse } from "../types";

type Props = {
  activeId: string | null;
  filePath: string;
  fileList: FileListResponse | null;
  filePreview: FileReadResponse | null;
  filePreviewHtml: string;
  iconForEntry: (name: string, kind: "file" | "dir") => JSX.Element;
  onUp: () => void;
  onRefresh: () => void;
  onOpenEntry: (nextPath: string, kind: "file" | "dir") => void;
};

const BYTE_UNIT = 1;
const KILOBYTE_UNIT = 1024;
const MEGABYTE_UNIT = 1024 * 1024;
const GIGABYTE_UNIT = 1024 * 1024 * 1024;

const formatFileSize = (sizeBytes?: number): string | null => {
  /* Directory rows and unknown metadata should keep the trailing slot empty. */
  if (!Number.isFinite(sizeBytes) || typeof sizeBytes !== "number" || sizeBytes < 0) {
    return null;
  }

  /* Byte values stay integer to avoid noisy decimals for tiny files. */
  if (sizeBytes < KILOBYTE_UNIT) {
    return `${Math.round(sizeBytes / BYTE_UNIT)} B`;
  }

  /* Format larger units with at most one decimal so the list stays compact on mobile. */
  const formatCompactUnit = (value: number, unit: "KB" | "MB" | "GB"): string => {
    const rounded = Math.round(value * 10) / 10;
    const normalized = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${normalized} ${unit}`;
  };

  if (sizeBytes < MEGABYTE_UNIT) {
    return formatCompactUnit(sizeBytes / KILOBYTE_UNIT, "KB");
  }

  if (sizeBytes < GIGABYTE_UNIT) {
    return formatCompactUnit(sizeBytes / MEGABYTE_UNIT, "MB");
  }

  return formatCompactUnit(sizeBytes / GIGABYTE_UNIT, "GB");
};

export const FilesTab = (props: Props) => {
  /* Disable parent navigation when explorer is already at project root. */
  const normalizedPath = props.filePath.trim().replace(/^\/+|\/+$/g, "");
  const canGoUp = Boolean(props.activeId) && normalizedPath.length > 0;

  /* File explorer and preview. */
  return (
    <div className="files-shell">
      <div className="files-toolbar">
        <button
          className="icon-tool-btn"
          onClick={props.onUp}
          disabled={!canGoUp}
          type="button"
          title="Go to parent folder"
          aria-label="Go up"
        >
          <ArrowUp size={16} className="btn-icon" />
        </button>
        <div className="files-path">{props.filePath || "/"}</div>
        <button
          className="icon-tool-btn"
          onClick={props.onRefresh}
          disabled={!props.activeId}
          type="button"
          title="Refresh current folder"
          aria-label="Refresh"
        >
          <RefreshCw size={16} className="btn-icon" />
        </button>
      </div>

      <div className="files-grid">
        <div className="files-list">
          {props.fileList?.entries?.length ? (
            props.fileList.entries.map((e) => (
              <button
                key={`${e.kind}:${e.name}`}
                className={e.kind === "dir" ? "file-item dir" : "file-item"}
                onClick={() => {
                  /* Compose next path without duplicating slashes when navigating deep folders. */
                  const base = props.filePath.trim();
                  const next = !base ? e.name : base === "/" ? `/${e.name}` : `${base.replace(/\/+$/, "")}/${e.name}`;
                  props.onOpenEntry(next, e.kind);
                }}
              >
                <span className="file-icon">{props.iconForEntry(e.name, e.kind)}</span>
                <span className="file-name">{e.name}</span>
                <span className="file-trailing">
                  {e.kind === "file" ? <span className="file-size">{formatFileSize(e.sizeBytes)}</span> : null}
                  {e.kind === "dir" ? <FolderOpen size={16} className="icon hint" /> : null}
                </span>
              </button>
            ))
          ) : (
            <div className="placeholder">No entries (or not loaded yet).</div>
          )}
        </div>

        <div className="files-preview">
          {props.filePreview ? (
            <>
              <div className="files-preview-title">{props.filePreview.path}</div>
              <div className="files-preview-body">
                <div
                  className="codebox"
                  // Shiki emits already-escaped HTML with spans.
                  dangerouslySetInnerHTML={{ __html: props.filePreviewHtml }}
                />
              </div>
            </>
          ) : (
            <div className="placeholder">Select a file to preview.</div>
          )}
        </div>
      </div>
    </div>
  );
};
