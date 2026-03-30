/**
 * @fileoverview Shared centered modal shell for compact Mini App workflows.
 *
 * Exports:
 * - ActionModalTone - Visual tone preset for icon/background accents.
 * - ActionModalCard - Reusable highlighted card block for subject/selection summaries inside the modal body.
 * - ActionModal - Handles backdrop, Escape/scroll locking, branded header, body and footer slots.
 */

import "../action-modal.css";

import { ReactNode, useEffect, useId, useState } from "react";
import { X } from "lucide-react";

const ACTION_MODAL_EXIT_DURATION_MS = 180;

export type ActionModalTone = "neutral" | "primary" | "danger";

type ActionModalCardProps = {
  label: string;
  title: string;
  meta?: string[];
};

type Props = {
  isOpen: boolean;
  title: string;
  description?: string;
  eyebrow?: string;
  icon?: ReactNode;
  tone?: ActionModalTone;
  closeLabel?: string;
  showCloseButton?: boolean;
  isBusy?: boolean;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
};

export const ActionModalCard = (props: ActionModalCardProps) => {
  /* Subject cards keep destructive targets and creation context visually distinct from the rest of modal copy. */
  const visibleMeta = (props.meta ?? []).filter((item) => item.trim().length > 0);

  return (
    <div className="action-modal-card">
      <div className="action-modal-card-label">{props.label}</div>
      <div className="action-modal-card-title">{props.title}</div>

      {visibleMeta.length > 0 ? (
        <div className="action-modal-card-meta">
          {visibleMeta.map((item, index) => (
            <span key={`${item}-${index}`}>{item}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export const ActionModal = (props: Props) => {
  const titleId = useId();
  const descriptionId = useId();
  const tone = props.tone ?? "neutral";
  const [shouldRender, setShouldRender] = useState<boolean>(props.isOpen);
  const [isVisible, setIsVisible] = useState<boolean>(props.isOpen);

  useEffect(() => {
    /* Keep the shell mounted briefly on close so CSS transitions can animate instead of disappearing abruptly. */
    if (props.isOpen) {
      setShouldRender(true);

      const frameId = window.requestAnimationFrame(() => setIsVisible(true));
      return () => window.cancelAnimationFrame(frameId);
    }

    setIsVisible(false);
    const timeoutId = window.setTimeout(() => setShouldRender(false), ACTION_MODAL_EXIT_DURATION_MS);
    return () => window.clearTimeout(timeoutId);
  }, [props.isOpen]);

  useEffect(() => {
    /* Compact overlays should freeze background scroll so mobile operators do not lose context while editing modal fields. */
    if (!shouldRender) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [shouldRender]);

  useEffect(() => {
    /* Shared Escape handling keeps every compact modal dismissible without duplicating listeners per workflow. */
    if (!shouldRender) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !props.isBusy) {
        props.onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.isBusy, props.onClose, shouldRender]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      className="action-modal-backdrop"
      data-state={isVisible ? "open" : "closed"}
      role="presentation"
      onClick={(event) => {
        /* Shared backdrop close must stay opt-out while a submit is running, otherwise double taps can hide active work. */
        event.stopPropagation();
        if (event.target === event.currentTarget && !props.isBusy) {
          props.onClose();
        }
      }}
    >
      <div
        className="action-modal"
        data-state={isVisible ? "open" : "closed"}
        data-tone={tone}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={props.description ? descriptionId : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="action-modal-header">
          <div className="action-modal-hero">
            {props.icon ? (
              <div className="action-modal-icon" data-tone={tone} aria-hidden="true">
                {props.icon}
              </div>
            ) : null}

            <div className="action-modal-copy">
              {props.eyebrow ? <div className="action-modal-eyebrow">{props.eyebrow}</div> : null}
              <h3 id={titleId} className="action-modal-title">
                {props.title}
              </h3>
              {props.description ? (
                <p id={descriptionId} className="action-modal-description">
                  {props.description}
                </p>
              ) : null}
            </div>
          </div>

          {props.showCloseButton === false ? null : (
            <button
              className="action-modal-close"
              type="button"
              aria-label={props.closeLabel ?? "Close dialog"}
              disabled={props.isBusy}
              onClick={props.onClose}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {props.children ? <div className="action-modal-body">{props.children}</div> : null}
        {props.footer ? <div className="action-modal-actions">{props.footer}</div> : null}
      </div>
    </div>
  );
};
