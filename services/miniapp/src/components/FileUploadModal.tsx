/**
 * @fileoverview Modal for adding files into the currently opened project folder.
 *
 * Exports:
 * - FileUploadModal - Supports local device upload and external URL import flows.
 */

import { useEffect, useId, useState } from "react";
import { File, Upload, X } from "lucide-react";

type UploadMode = "device" | "url";

type Props = {
  isOpen: boolean;
  currentPath: string;
  onClose: () => void;
  onUploadFile: (file: File) => Promise<void> | void;
  onImportFromUrl: (url: string) => Promise<void> | void;
};

const DEVICE_MODE: UploadMode = "device";
const URL_MODE: UploadMode = "url";
const EMPTY_VALUE = "";

export const FileUploadModal = (props: Props) => {
  const titleId = useId();
  const [mode, setMode] = useState<UploadMode>(DEVICE_MODE);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [urlDraft, setUrlDraft] = useState<string>(EMPTY_VALUE);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    /* Reset transient modal state after close so every reopen starts from a clean upload form. */
    if (props.isOpen) {
      return;
    }

    setMode(DEVICE_MODE);
    setSelectedFile(null);
    setUrlDraft(EMPTY_VALUE);
    setIsSubmitting(false);
    setSubmitError(null);
  }, [props.isOpen]);

  useEffect(() => {
    /* Keep background fixed while the upload dialog is open on mobile. */
    if (!props.isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [props.isOpen]);

  useEffect(() => {
    /* Escape closes the modal for keyboard users without forcing pointer interaction. */
    if (!props.isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      props.onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.isOpen, props.onClose]);

  if (!props.isOpen) {
    return null;
  }

  const submit = async (): Promise<void> => {
    /* Each mode validates its own required input and keeps errors visible inside the dialog. */
    setSubmitError(null);

    try {
      setIsSubmitting(true);
      if (mode === DEVICE_MODE) {
        if (!selectedFile) {
          throw new Error("Choose a file from your device first.");
        }

        await props.onUploadFile(selectedFile);
      } else {
        const normalizedUrl = urlDraft.trim();
        if (!normalizedUrl) {
          throw new Error("File URL is required.");
        }

        if (!URL.canParse(normalizedUrl)) {
          throw new Error("Enter a valid file URL.");
        }

        const parsedUrl = new URL(normalizedUrl);
        if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
          throw new Error("Only http/https URLs are supported.");
        }

        await props.onImportFromUrl(normalizedUrl);
      }

      props.onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "File import failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentFolderLabel = props.currentPath.trim() || "/";

  return (
    <div className="files-upload-modal-backdrop" onClick={props.onClose} role="presentation">
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="files-upload-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="files-upload-modal-header">
          <div>
            <h2 id={titleId} className="files-upload-modal-title">
              Add file
            </h2>
            <div className="files-upload-target">Current folder: {currentFolderLabel}</div>
          </div>

          <button className="btn ghost btn-icon files-upload-close-btn" onClick={props.onClose} type="button" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="files-upload-mode-row">
          <button
            className={mode === DEVICE_MODE ? "files-upload-mode-btn files-upload-mode-btn-active" : "files-upload-mode-btn"}
            onClick={() => setMode(DEVICE_MODE)}
            type="button"
          >
            From device
          </button>
          <button
            className={mode === URL_MODE ? "files-upload-mode-btn files-upload-mode-btn-active" : "files-upload-mode-btn"}
            onClick={() => setMode(URL_MODE)}
            type="button"
          >
            From link
          </button>
        </div>

        {mode === DEVICE_MODE ? (
          <div key="device" className="files-upload-field">
            <span className="files-upload-field-label">Choose file from device</span>
            <label className="files-upload-dropzone">
              <input
                aria-label="Choose file from device"
                className="files-upload-hidden-input"
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setSelectedFile(nextFile);
                }}
                type="file"
              />
              {!selectedFile ? (
                <div className="files-upload-dropzone-prompt">
                  <Upload size={24} className="files-upload-dropzone-icon" />
                  <span>Click to select or drag and drop</span>
                </div>
              ) : (
                <div className="files-upload-selected-file">
                  <File size={20} className="files-upload-selected-icon" />
                  <span className="files-upload-selected-name">{selectedFile.name}</span>
                  <button
                    className="files-upload-selected-remove"
                    onClick={(e) => {
                      e.preventDefault();
                      setSelectedFile(null);
                    }}
                    type="button"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </label>
            <span className="files-upload-note">The file is uploaded directly into the folder that is currently open in Files.</span>
          </div>
        ) : (
          <label key="url" className="files-upload-field">
            <span className="files-upload-field-label">File URL</span>
            <input
              aria-label="File URL"
              className="input"
              onChange={(event) => setUrlDraft(event.target.value)}
              placeholder="https://example.com/assets/logo.svg"
              type="url"
              value={urlDraft}
            />
            <span className="files-upload-note">Backend downloads the remote file into the folder you have opened right now.</span>
          </label>
        )}

        {submitError ? <div className="alert">{submitError}</div> : null}

        <div className="files-upload-modal-actions">
          <button className="btn ghost" onClick={props.onClose} type="button">
            Cancel
          </button>
          <button className="btn primary" disabled={isSubmitting} onClick={() => void submit()} type="button">
            {isSubmitting ? "Working..." : mode === DEVICE_MODE ? "Upload file" : "Import file"}
          </button>
        </div>
      </div>
    </div>
  );
};
