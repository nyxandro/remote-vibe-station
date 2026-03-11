/**
 * @fileoverview Fullscreen text-file preview modal with download action.
 *
 * Exports:
 * - FilePreviewModal - Opens project file content in the shared fullscreen code modal.
 */

import { useEffect, ReactNode } from "react";
import { Download, X } from "lucide-react";

import { ThemeMode } from "../utils/theme";
import { inferTextEditorLanguage } from "../utils/text-editor-language";
import { FullscreenCodeModal } from "./FullscreenCodeModal";

type Props = {
  isOpen: boolean;
  themeMode: ThemeMode;
  filePath: string;
  content: string;
  onClose: () => void;
  onDownload: () => void;
};

const NOOP = () => {};

export const FilePreviewModal = (props: Props) => {
  useEffect(() => {
    /* Prevent background scroll while preview is visible so mobile file reading stays focused. */
    if (!props.isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [props.isOpen]);

  return (
    <FullscreenCodeModal
      filePath={props.filePath}
      headerActions={
        <button className="btn outline btn-icon" onClick={props.onDownload} type="button" title="Download file">
          <Download size={20} />
        </button>
      }
      isOpen={props.isOpen}
      language={inferTextEditorLanguage(props.filePath)}
      onChange={NOOP}
      onClose={props.onClose}
      readOnly
      themeMode={props.themeMode}
      value={props.content}
    />
  );
};
