/**
 * @fileoverview Reusable destructive-action confirmation wrapper over the shared Mini App modal shell.
 *
 * Exports:
 * - DangerConfirmModal - Renders danger-specific copy, subject card and confirm/cancel actions.
 */

import { AlertTriangle, Trash2 } from "lucide-react";

import { ActionModal, ActionModalCard } from "./ActionModal";

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
  return (
    <ActionModal
      isOpen
      title={props.title}
      description={props.description}
      eyebrow="Destructive action"
      icon={<AlertTriangle size={22} />}
      tone="danger"
      showCloseButton={false}
      isBusy={props.isBusy}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" disabled={props.isBusy} onClick={props.onClose} type="button">
            {props.cancelLabel}
          </button>

          <button
            className="btn primary danger-confirm-primary"
            disabled={props.isBusy}
            onClick={() => {
              /* Shared danger wrapper still owns the async confirm boundary so callers keep one simple onConfirm callback. */
              void props.onConfirm();
            }}
            type="button"
          >
            <Trash2 size={16} />
            {props.isBusy ? props.confirmBusyLabel ?? props.confirmLabel : props.confirmLabel}
          </button>
        </>
      }
    >
      <ActionModalCard label={props.subjectLabel} title={props.subjectTitle} meta={props.subjectMeta} />
    </ActionModal>
  );
};
