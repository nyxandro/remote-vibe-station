/**
 * @fileoverview Modal for adding files into the currently opened project folder.
 *
 * Exports:
 * - FileUploadModal - Supports local device upload and external URL import flows.
 */

import { useEffect, useId, useRef, useState } from "react";
import { File, Link2, Upload, X } from "lucide-react";

import { ActionModal } from "./ActionModal";

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
  const tabPanelId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  if (!props.isOpen) {
    return null;
  }

  const switchMode = (nextMode: UploadMode): void => {
    /* Shared modal tabs should switch instantly but never while a submit is still running. */
    if (isSubmitting) {
      return;
    }

    setMode(nextMode);
    setSubmitError(null);
  };

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

  const openLocalFilePicker = (): void => {
    /* Mobile layout replaces the dropzone with a plain button, both backed by the same hidden input. */
    fileInputRef.current?.click();
  };

  return (
    <ActionModal
      isOpen={props.isOpen}
      title="Add file"
      description={`Current folder: ${currentFolderLabel}`}
      tone="primary"
      closeLabel="Close add file"
      isBusy={isSubmitting}
      onClose={props.onClose}
      footer={
        <button className="btn primary" disabled={isSubmitting} onClick={() => void submit()} type="button">
          {isSubmitting ? "Working..." : mode === DEVICE_MODE ? "Upload file" : "Import file"}
        </button>
      }
    >
      <div className="project-add-modal-mode-row" role="tablist" aria-label="File add mode">
        <button
          className={mode === DEVICE_MODE ? "project-add-modal-mode-btn project-add-modal-mode-btn-active" : "project-add-modal-mode-btn"}
          role="tab"
          aria-selected={mode === DEVICE_MODE}
          aria-controls={tabPanelId}
          disabled={isSubmitting}
          onClick={() => switchMode(DEVICE_MODE)}
          type="button"
        >
          <Upload size={16} aria-hidden="true" />
          <span>Local</span>
        </button>
        <button
          className={mode === URL_MODE ? "project-add-modal-mode-btn project-add-modal-mode-btn-active" : "project-add-modal-mode-btn"}
          role="tab"
          aria-selected={mode === URL_MODE}
          aria-controls={tabPanelId}
          disabled={isSubmitting}
          onClick={() => switchMode(URL_MODE)}
          type="button"
        >
          <Link2 size={16} aria-hidden="true" />
          <span>Link</span>
        </button>
      </div>

      <div className="project-add-modal-form" id={tabPanelId} role="tabpanel">
        {mode === DEVICE_MODE ? (
          <div key="device" className="files-upload-field">
            <input
              ref={fileInputRef}
              aria-label="Choose file from device"
              className="files-upload-device-input"
              onChange={(event) => {
                /* Reset the native input after each pick so selecting the same file again still emits a change event. */
                const nextFile = event.target.files?.[0] ?? null;
                setSelectedFile(nextFile);
                event.target.value = EMPTY_VALUE;
              }}
              type="file"
            />

            {!selectedFile ? (
              <>
                <button className="files-upload-dropzone" onClick={openLocalFilePicker} type="button">
                  <div className="files-upload-dropzone-prompt files-upload-dropzone-prompt-desktop">
                    <Upload size={24} className="files-upload-dropzone-icon" />
                    <span>Click to select a file</span>
                  </div>
                </button>

                <button className="btn outline files-upload-mobile-picker" onClick={openLocalFilePicker} type="button">
                  Choose files
                </button>
              </>
            ) : (
              <div className="files-upload-selected-file">
                <File size={20} className="files-upload-selected-icon" />
                <span className="files-upload-selected-name">{selectedFile.name}</span>
                <button
                  className="files-upload-selected-remove"
                  aria-label="Remove selected file"
                  onClick={() => {
                    /* Clearing the selected file should return the modal to the same picker UI without reopening it. */
                    setSelectedFile(null);
                  }}
                  type="button"
                >
                  <X size={14} />
                </button>
              </div>
            )}

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
      </div>
    </ActionModal>
  );
};
