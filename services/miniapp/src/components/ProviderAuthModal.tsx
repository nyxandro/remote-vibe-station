/**
 * @fileoverview Modal for OpenCode provider API-key and OAuth onboarding.
 *
 * Exports:
 * - ProviderAuthModal - Renders the active OpenCode provider auth step inside the shared modal shell.
 */

import { ExternalLink, KeyRound, Link2 } from "lucide-react";

import { ProviderOAuthState } from "../hooks/use-provider-auth";
import { PROVIDERS_TAB_FIELD_IDS } from "./providers-tab-field-ids";
import { ActionModal } from "./ActionModal";

type Props = {
  oauthState: ProviderOAuthState | null;
  providerLabel: string;
  isSubmitting: boolean;
  apiKeyDraft: string;
  codeDraft: string;
  onApiKeyChange: (value: string) => void;
  onCodeChange: (value: string) => void;
  onClose: () => void;
  onSubmitApiKey: () => void;
  onSubmitOAuthCode: () => void;
  onCompleteOAuthAuto: () => void;
};

export const ProviderAuthModal = (props: Props) => {
  if (!props.oauthState) {
    return null;
  }

  const isApiFlow = props.oauthState.instructions === "api";
  const title = isApiFlow ? `API key для ${props.providerLabel}` : `Подключить ${props.providerLabel}`;
  const description = isApiFlow
    ? "Введите API key провайдера. Mini App сохранит его через OpenCode /auth endpoint."
    : props.oauthState.instructions;

  return (
    <ActionModal
      isOpen
      title={title}
      description={description}
      eyebrow="OpenCode provider"
      icon={isApiFlow ? <KeyRound size={20} /> : <Link2 size={20} />}
      tone="primary"
      closeLabel="Закрыть подключение OpenCode провайдера"
      isBusy={props.isSubmitting}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn ghost" type="button" disabled={props.isSubmitting} onClick={props.onClose}>
            Отмена
          </button>
          {isApiFlow ? (
            <button className="btn primary" type="button" disabled={props.isSubmitting} onClick={props.onSubmitApiKey}>
              {props.isSubmitting ? "Сохраняем..." : "Подключить по API ключу"}
            </button>
          ) : props.oauthState.method === "auto" ? (
            <button className="btn primary" type="button" disabled={props.isSubmitting} onClick={props.onCompleteOAuthAuto}>
              {props.isSubmitting ? "Проверяем..." : "Проверить подключение"}
            </button>
          ) : (
            <button className="btn primary" type="button" disabled={props.isSubmitting} onClick={props.onSubmitOAuthCode}>
              {props.isSubmitting ? "Завершаем..." : "Завершить OAuth"}
            </button>
          )}
        </>
      }
    >
      <div className="providers-auth-modal-fields">
        {isApiFlow ? (
          <input
            id={PROVIDERS_TAB_FIELD_IDS.apiKey}
            name={PROVIDERS_TAB_FIELD_IDS.apiKey}
            aria-label="API key"
            className="input settings-input-compact"
            placeholder="Введите API ключ"
            type="password"
            autoComplete="new-password"
            value={props.apiKeyDraft}
            onChange={(event) => props.onApiKeyChange(event.target.value)}
          />
        ) : (
          <>
            <a className="btn outline providers-auth-modal-link" href={props.oauthState.url} target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              Открыть авторизацию
            </a>

            {props.oauthState.method === "code" ? (
              <input
                id={PROVIDERS_TAB_FIELD_IDS.oauthCode}
                name={PROVIDERS_TAB_FIELD_IDS.oauthCode}
                aria-label="OAuth code"
                className="input settings-input-compact"
                placeholder="Введите OAuth code"
                value={props.codeDraft}
                onChange={(event) => props.onCodeChange(event.target.value)}
              />
            ) : null}
          </>
        )}
      </div>
    </ActionModal>
  );
};
