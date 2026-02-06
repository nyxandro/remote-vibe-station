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

export const FilesTab = (props: Props) => {
  /* File explorer and preview. */
  return (
    <div className="files-shell">
      <div className="files-toolbar">
        <button
          className="icon-tool-btn"
          onClick={props.onUp}
          disabled={!props.activeId}
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
                  const base = props.filePath.trim();
                  const next = !base ? e.name : base === "/" ? `/${e.name}` : `${base.replace(/\/+$/, "")}/${e.name}`;
                  props.onOpenEntry(next, e.kind);
                }}
              >
                <span className="file-icon">{props.iconForEntry(e.name, e.kind)}</span>
                <span className="file-name">{e.name}</span>
                {e.kind === "dir" ? <FolderOpen size={16} className="icon hint" /> : null}
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
              <div
                className="codebox"
                // Shiki emits already-escaped HTML with spans.
                dangerouslySetInnerHTML={{ __html: props.filePreviewHtml }}
              />
            </>
          ) : (
            <div className="placeholder">Select a file to preview.</div>
          )}
        </div>
      </div>
    </div>
  );
};
