/**
 * @fileoverview Files tab UI with folder path strip, compact action toolbar, upload modal, and fullscreen preview.
 *
 * Exports:
 * - FilesTab - Renders project file list and delegates upload/preview actions.
 */

import { useState } from "react";
import { ArrowUp, FolderOpen, Plus, RefreshCw } from "lucide-react";

import { FileListResponse, FileReadResponse } from "../types";
import { ThemeMode } from "../utils/theme";
import { FilePreviewModal } from "./FilePreviewModal";
import { FileUploadModal } from "./FileUploadModal";

type Props = {
  activeId: string | null;
  filePath: string;
  fileList: FileListResponse | null;
  filePreview: FileReadResponse | null;
  themeMode: ThemeMode;
  iconForEntry: (name: string, kind: "file" | "dir") => JSX.Element;
  onUp: () => void;
  onRefresh: () => void;
  onOpenEntry: (nextPath: string, kind: "file" | "dir") => void;
  onClosePreview: () => void;
  onDownloadPreview: (relativePath: string) => Promise<void> | void;
  onUploadFromDevice: (currentPath: string, file: File) => Promise<void> | void;
  onImportFromUrl: (currentPath: string, url: string) => Promise<void> | void;
};

const BYTE_UNIT = 1;
const KILOBYTE_UNIT = 1024;
const MEGABYTE_UNIT = 1024 * 1024;
const GIGABYTE_UNIT = 1024 * 1024 * 1024;
const ROOT_PATH_LABEL = "/";

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

const joinEntryPath = (basePath: string, entryName: string): string => {
  /* Compose nested entry paths without leaking duplicate slashes into API requests. */
  const base = basePath.trim();
  if (!base) {
    return entryName;
  }

  if (base === ROOT_PATH_LABEL) {
    return `/${entryName}`;
  }

  return `${base.replace(/\/+$/g, "")}/${entryName}`;
};

export const FilesTab = (props: Props) => {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);

  /* Disable parent navigation when explorer is already at project root. */
  const normalizedPath = props.filePath.trim().replace(/^\/+|\/+$/g, "");
  const canGoUp = Boolean(props.activeId) && normalizedPath.length > 0;
  const currentFolderLabel = normalizedPath || ROOT_PATH_LABEL;

  return (
    <div className="files-shell">
      <div className="files-location-strip">{currentFolderLabel}</div>

      <div className="files-toolbar">
        <div className="files-toolbar-actions">
          <button
            aria-label="Add file"
            className="icon-tool-btn"
            disabled={!props.activeId}
            onClick={() => setIsUploadModalOpen(true)}
            title="Add new file"
            type="button"
          >
            <Plus size={16} className="btn-icon" />
          </button>

          <button
            aria-label="Refresh"
            className="icon-tool-btn"
            disabled={!props.activeId}
            onClick={props.onRefresh}
            title="Refresh current folder"
            type="button"
          >
            <RefreshCw size={16} className="btn-icon" />
          </button>

          <button
            aria-label="Go up"
            className="icon-tool-btn"
            disabled={!canGoUp}
            onClick={props.onUp}
            title="Go to parent folder"
            type="button"
          >
            <ArrowUp size={16} className="btn-icon" />
          </button>
        </div>
      </div>

      <div className="files-grid">
        <div className="files-list">
          {props.fileList?.entries?.length ? (
            props.fileList.entries.map((entry) => (
              <button
                key={`${entry.kind}:${entry.name}`}
                className={entry.kind === "dir" ? "file-item dir" : "file-item"}
                onClick={() => props.onOpenEntry(joinEntryPath(props.filePath, entry.name), entry.kind)}
                type="button"
              >
                <span className="file-icon">{props.iconForEntry(entry.name, entry.kind)}</span>
                <span className="file-name">{entry.name}</span>
                <span className="file-trailing">
                  {entry.kind === "file" ? <span className="file-size">{formatFileSize(entry.sizeBytes)}</span> : null}
                  {entry.kind === "dir" ? <FolderOpen size={16} className="icon hint" /> : null}
                </span>
              </button>
            ))
          ) : (
            <div className="placeholder">No entries (or not loaded yet).</div>
          )}
        </div>
      </div>

      <FileUploadModal
        currentPath={currentFolderLabel}
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onImportFromUrl={(url) => props.onImportFromUrl(props.filePath, url)}
        onUploadFile={(file) => props.onUploadFromDevice(props.filePath, file)}
      />

      <FilePreviewModal
        content={props.filePreview?.content ?? ""}
        filePath={props.filePreview?.path ?? ""}
        isOpen={Boolean(props.filePreview)}
        onClose={props.onClosePreview}
        onDownload={() => {
          if (!props.filePreview) {
            return;
          }

          void props.onDownloadPreview(props.filePreview.path);
        }}
        themeMode={props.themeMode}
      />
    </div>
  );
};
