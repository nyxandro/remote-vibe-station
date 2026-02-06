/**
 * @fileoverview Full-screen diff preview opened via Telegram startapp token.
 *
 * Exports:
 * - DiffPreviewScreen (L38) - Loads and renders file diff by token.
 */

import { useEffect, useMemo, useState } from "react";

import { apiGet } from "../api/client";
import { DiffPreviewResponse } from "../types";
import "../diff-preview.css";

type DiffPreviewScreenProps = {
  token: string;
  onClose: () => void;
};

const operationLabel = (value: DiffPreviewResponse["operation"]): string => {
  /* Keep operation labels consistent with Telegram runtime stream. */
  if (value === "create") {
    return "Создание файла";
  }
  if (value === "delete") {
    return "Удаление файла";
  }
  return "Редактирование файла";
};

const diffLineClass = (line: string): string => {
  /* Highlight additions/deletions while keeping headers neutral. */
  if (line.startsWith("+++") || line.startsWith("---")) {
    return "diff-line diff-line-meta";
  }
  if (line.startsWith("+")) {
    return "diff-line diff-line-add";
  }
  if (line.startsWith("-")) {
    return "diff-line diff-line-del";
  }
  if (line.startsWith("@@") || line.startsWith("Index:") || line.startsWith("=")) {
    return "diff-line diff-line-meta";
  }
  return "diff-line";
};

export const DiffPreviewScreen = ({ token, onClose }: DiffPreviewScreenProps) => {
  const [preview, setPreview] = useState<DiffPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    /* Load preview payload once per token. */
    void (async () => {
      try {
        setError(null);
        const data = await apiGet<DiffPreviewResponse>(`/api/telegram/diff-preview/${encodeURIComponent(token)}`);
        setPreview(data);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Не удалось загрузить diff";
        setError(message);
      }
    })();
  }, [token]);

  const lines = useMemo(() => {
    /* Split unified diff text for per-line styling. */
    if (!preview?.diff) {
      return [] as string[];
    }
    return preview.diff.split(/\r?\n/g);
  }, [preview]);

  return (
    <section className="diff-preview-screen">
      <button className="diff-preview-close" onClick={onClose} aria-label="Закрыть diff preview">
        Закрыть
      </button>

      {error ? <div className="diff-preview-error">{error}</div> : null}

      {preview ? (
        <>
          <div className="diff-preview-meta">
            <div className="diff-preview-op">{operationLabel(preview.operation)}</div>
            <div className="diff-preview-counts">+{preview.additions} -{preview.deletions}</div>
          </div>

          <div className="diff-preview-path">{preview.absolutePath}</div>

          <pre className="diff-preview-body">
            {lines.map((line, index) => (
              <span key={`${index}-${line}`} className={diffLineClass(line)}>
                {line || " "}
              </span>
            ))}
          </pre>
        </>
      ) : null}
    </section>
  );
};
