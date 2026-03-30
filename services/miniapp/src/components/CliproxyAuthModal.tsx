/**
 * @fileoverview Modal for finishing a CLIProxy provider OAuth handoff.
 *
 * Exports:
 * - CliproxyAuthModal - Renders callback/code/state inputs in an overlay and submits the active provider auth step.
 */

import { ExternalLink, Link2 } from "lucide-react";

import { CliproxyOAuthStartPayload } from "../types";
import { ActionModal } from "./ActionModal";
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
  if (!props.oauthStart) {
    return null;
  }

  return (
    <ActionModal
      isOpen
      title={`Подключить ${props.providerLabel}`}
      description={props.oauthStart.instructions}
      eyebrow="CLIProxy OAuth"
      icon={<Link2 size={20} />}
      tone="primary"
      closeLabel="Закрыть подключение CLIProxy"
      isBusy={props.isSubmitting}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" type="button" disabled={props.isSubmitting} onClick={props.onClose}>
            Отмена
          </button>
          <button className="btn primary" type="button" disabled={props.isSubmitting} onClick={props.onSubmit}>
            {props.isSubmitting ? "Сохраняем..." : "Завершить подключение"}
          </button>
        </>
      }
    >
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
    </ActionModal>
  );
};
