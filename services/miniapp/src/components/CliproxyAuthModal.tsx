/**
 * @fileoverview Modal for finishing a CLIProxy provider OAuth handoff.
 *
 * Exports:
 * - CliproxyAuthModal - Renders callback/code/state inputs in an overlay and submits the active provider auth step.
 */

import { useEffect, useId } from "react";
import { ExternalLink, X } from "lucide-react";

import { CliproxyOAuthStartPayload } from "../types";
import { PROVIDERS_TAB_FIELD_IDS } from "./providers-tab-field-ids";

type Props = {
  oauthStart: CliproxyOAuthStartPayload | null;
  providerLabel: string;
  isSubmitting: boolean;
  callbackUrlDraft: string;
  codeDraft: string;
  stateDraft: string;
  onCallbackUrlChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onStateChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export const CliproxyAuthModal = (props: Props) => {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    /* Lock background scroll while the auth overlay is open so mobile users do not lose context mid-flow. */
    if (!props.oauthStart) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [props.oauthStart]);

  useEffect(() => {
    /* Escape should dismiss the modal unless a submit is already in flight. */
    if (!props.oauthStart) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !props.isSubmitting) {
        props.onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.isSubmitting, props.oauthStart, props.onClose]);

  if (!props.oauthStart) {
    return null;
  }

  return (
    <div
      className="providers-auth-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        /* Backdrop close keeps the flow dismissible without leaking clicks into the providers screen below. */
        if (event.target === event.currentTarget && !props.isSubmitting) {
          props.onClose();
        }
      }}
    >
      <div
        className="providers-auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="providers-auth-modal-header">
          <div className="providers-auth-modal-copy">
            <div className="providers-auth-modal-eyebrow">CLIProxy OAuth</div>
            <h3 id={titleId} className="providers-auth-modal-title">
              Подключить {props.providerLabel}
            </h3>
            <p id={descriptionId} className="providers-auth-modal-description">
              {props.oauthStart.instructions}
            </p>
          </div>

          <button
            className="btn ghost btn-icon"
            type="button"
            aria-label="Закрыть подключение CLIProxy"
            disabled={props.isSubmitting}
            onClick={props.onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="providers-auth-modal-fields">
          {/* Browser auth stays first because most flows start there before the operator pastes callback data back. */}
          <a className="btn outline providers-auth-modal-link" href={props.oauthStart.url} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            Открыть авторизацию
          </a>

          <input
            id={PROVIDERS_TAB_FIELD_IDS.cliproxyCallbackUrl}
            name={PROVIDERS_TAB_FIELD_IDS.cliproxyCallbackUrl}
            aria-label="CLIProxy callback URL"
            className="input settings-input-compact"
            placeholder="Вставьте callback URL целиком"
            value={props.callbackUrlDraft}
            onChange={(event) => props.onCallbackUrlChange(event.target.value)}
          />
          <input
            id={PROVIDERS_TAB_FIELD_IDS.cliproxyCode}
            name={PROVIDERS_TAB_FIELD_IDS.cliproxyCode}
            aria-label="CLIProxy OAuth code"
            className="input settings-input-compact"
            placeholder="Или отдельно code"
            value={props.codeDraft}
            onChange={(event) => props.onCodeChange(event.target.value)}
          />
          <input
            id={PROVIDERS_TAB_FIELD_IDS.cliproxyState}
            name={PROVIDERS_TAB_FIELD_IDS.cliproxyState}
            aria-label="CLIProxy OAuth state"
            className="input settings-input-compact"
            placeholder="state"
            value={props.stateDraft}
            onChange={(event) => props.onStateChange(event.target.value)}
          />
        </div>

        <div className="providers-auth-modal-actions">
          <button className="btn ghost" type="button" disabled={props.isSubmitting} onClick={props.onClose}>
            Отмена
          </button>
          <button className="btn primary" type="button" disabled={props.isSubmitting} onClick={props.onSubmit}>
            {props.isSubmitting ? "Сохраняем..." : "Завершить подключение"}
          </button>
        </div>
      </div>
    </div>
  );
};
