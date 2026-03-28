/**
 * @fileoverview Reusable destructive-action confirmation modal for Mini App workflows.
 *
 * Exports:
 * - DangerConfirmModal - Renders branded confirmation UI with subject card and confirm/cancel actions.
 */

import "../danger-confirm-modal.css";

import { AlertTriangle, Trash2 } from "lucide-react";

type Props = {
  title: string;
  description: string;
  subjectLabel: string;
  subjectTitle: string;
  subjectMeta?: string[];
  cancelLabel: string;
  confirmLabel: string;
  confirmBusyLabel?: string;
  isBusy: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
};

export const DangerConfirmModal = (props: Props) => {
  const visibleMeta = (props.subjectMeta ?? []).filter((item) => item.trim().length > 0);

  return (
    <div
      className="danger-confirm-backdrop"
      role="presentation"
      onClick={(event) => {
        /* Nested confirmation layers must not leak clicks into underlying editors or settings backdrops. */
        event.stopPropagation();
        if (event.target === event.currentTarget && !props.isBusy) {
          props.onClose();
        }
      }}
    >
      <div
        className="danger-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="danger-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="danger-confirm-hero">
          <div className="danger-confirm-icon" aria-hidden="true">
            <AlertTriangle size={22} />
          </div>

          <div className="danger-confirm-copy">
            <div className="danger-confirm-eyebrow">Destructive action</div>
            <h3 id="danger-confirm-title" className="danger-confirm-title">
              {props.title}
            </h3>
            <p className="danger-confirm-description">{props.description}</p>
          </div>
        </div>

        <div className="danger-confirm-card">
          <div className="danger-confirm-card-label">{props.subjectLabel}</div>
          <div className="danger-confirm-card-title">{props.subjectTitle}</div>

          {visibleMeta.length > 0 ? (
            <div className="danger-confirm-meta">
              {visibleMeta.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="danger-confirm-actions">
          <button className="btn ghost" disabled={props.isBusy} onClick={props.onClose} type="button">
            {props.cancelLabel}
          </button>

          <button
            className="btn primary danger-confirm-primary"
            disabled={props.isBusy}
            onClick={() => {
              void props.onConfirm();
            }}
            type="button"
          >
            <Trash2 size={16} />
            {props.isBusy ? props.confirmBusyLabel ?? props.confirmLabel : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
