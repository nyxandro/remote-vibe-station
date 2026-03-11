/**
 * @fileoverview Project-scoped file explorer state and mutations for the Mini App.
 *
 * Exports:
 * - useProjectFiles - Owns current folder state, file preview, uploads, URL imports, and downloads.
 */

import { useState } from "react";

import { apiDownload, apiGet, apiPost, apiPostFormData } from "../api/client";
import { FileListResponse, FileReadResponse } from "../types";

type ProjectFileMutationResponse = {
  path: string;
  name: string;
  sizeBytes: number;
};

const FALLBACK_DOWNLOAD_NAME = "download";

export const useProjectFiles = (setError: (value: string | null) => void) => {
  const [filePath, setFilePath] = useState<string>("");
  const [fileList, setFileList] = useState<FileListResponse | null>(null);
  const [filePreview, setFilePreview] = useState<FileReadResponse | null>(null);

  const loadFilesOrThrow = async (projectId: string, nextPath: string): Promise<void> => {
    /* Shared raw loader lets upload/import flows fail when the refresh step fails. */
    const query = nextPath ? `?path=${encodeURIComponent(nextPath)}` : "";
    const data = await apiGet<FileListResponse>(`/api/projects/${projectId}/files${query}`);
    setFileList(data);
    setFilePath(nextPath);
  };

  const loadFiles = async (projectId: string, nextPath: string): Promise<void> => {
    /* Folder navigation refreshes one shallow directory at a time so explorer state stays explicit. */
    try {
      setError(null);
      await loadFilesOrThrow(projectId, nextPath);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load files");
    }
  };

  const openFile = async (projectId: string, relativePath: string): Promise<void> => {
    /* Preview loads the selected text file into the shared fullscreen viewer. */
    try {
      setError(null);
      const query = `?path=${encodeURIComponent(relativePath)}`;
      const data = await apiGet<FileReadResponse>(`/api/projects/${projectId}/file${query}`);
      setFilePreview(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to read file");
    }
  };

  const closeFilePreview = (): void => {
    /* Closing preview should not affect the current folder or file list contents. */
    setFilePreview(null);
  };

  const resetFiles = (): void => {
    /* Project deselection should clear folder path, file list, and fullscreen preview together. */
    setFilePath("");
    setFileList(null);
    setFilePreview(null);
  };

  const downloadFile = async (projectId: string, relativePath: string): Promise<void> => {
    /* Browser save uses authenticated fetch because file endpoints are protected by Mini App auth. */
    try {
      setError(null);
      const blob = await apiDownload(`/api/projects/${projectId}/files/download?path=${encodeURIComponent(relativePath)}`);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const fileName = relativePath.split("/").filter(Boolean).pop() ?? FALLBACK_DOWNLOAD_NAME;

      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to download file");
    }
  };

  const uploadFileFromDevice = async (projectId: string, currentPath: string, file: File): Promise<void> => {
    /* Device uploads preserve current folder context and refresh that directory after completion. */
    try {
      setError(null);
      const formData = new FormData();
      formData.set("path", currentPath);
      formData.set("file", file);
      await apiPostFormData<ProjectFileMutationResponse>(`/api/projects/${projectId}/files/upload`, formData);
      await loadFilesOrThrow(projectId, currentPath);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to upload file");
      throw error;
    }
  };

  const importFileFromUrl = async (projectId: string, currentPath: string, url: string): Promise<void> => {
    /* URL imports follow the same refresh flow as local uploads to keep file explorer state predictable. */
    try {
      setError(null);
      await apiPost<ProjectFileMutationResponse>(`/api/projects/${projectId}/files/import-url`, {
        path: currentPath,
        url
      });
      await loadFilesOrThrow(projectId, currentPath);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to import file from URL");
      throw error;
    }
  };

  return {
    filePath,
    fileList,
    filePreview,
    loadFiles,
    openFile,
    closeFilePreview,
    resetFiles,
    downloadFile,
    uploadFileFromDevice,
    importFileFromUrl
  };
};
