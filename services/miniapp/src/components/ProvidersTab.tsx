/**
 * @fileoverview Providers management tab with connect/disconnect and auth flows.
 *
 * Exports:
 * - ProvidersTab (L51) - Renders provider status, mode summary, and onboarding forms.
 */

import { useMemo, useState } from "react";

import { ProviderAuthMethod } from "../types";
import { ProviderOAuthState } from "../hooks/use-provider-auth";

type Props = {
  selected: {
    model: { providerID: string; modelID: string };
    thinking: string | null;
    agent: string | null;
  } | null;
  providers: Array<{ id: string; name: string; connected: boolean }>;
  authMethods: Record<string, ProviderAuthMethod[]>;
  isLoading: boolean;
  isSubmitting: boolean;
  oauthState: ProviderOAuthState | null;
  onRefresh: () => void;
  onStartConnect: (input: { providerID: string; methodIndex: number }) => void;
  onSubmitApiKey: (input: { providerID: string; key: string }) => void;
  onSubmitOAuthCode: () => void;
  onCompleteOAuthAuto: () => void;
  onDisconnect: (providerID: string) => void;
  onChangeOAuthCodeDraft?: (value: string) => void;
};

export const ProvidersTab = (props: Props) => {
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);
  const [apiKeyDraft, setApiKeyDraft] = useState<string>("");
  const [localCodeDraft, setLocalCodeDraft] = useState<string>(props.oauthState?.codeDraft ?? "");
  const [providerSearch, setProviderSearch] = useState<string>("");

  const providerMap = useMemo(() => {
    /* Keep O(1) lookup for provider labels in connect modal and oauth forms. */
    return new Map(props.providers.map((item) => [item.id, item.name]));
  }, [props.providers]);

  const connectedProviders = useMemo(() => {
    /* Main list intentionally shows only connected providers to reduce visual noise. */
    return props.providers.filter((provider) => provider.connected);
  }, [props.providers]);

  const connectableProviders = useMemo(() => {
    /* Add-provider picker is limited to disconnected providers only. */
    return props.providers.filter((provider) => !provider.connected);
  }, [props.providers]);

  const filteredConnectableProviders = useMemo(() => {
    /* Support quick prefix/substring search by provider name or ID. */
    const query = providerSearch.trim().toLowerCase();
    if (!query) {
      return connectableProviders;
    }

    return connectableProviders.filter((provider) => {
      return (
        provider.name.toLowerCase().includes(query) || provider.id.toLowerCase().includes(query)
      );
    });
  }, [connectableProviders, providerSearch]);

  const isApiFlow = props.oauthState?.instructions === "api";

  return (
    <section className="providers-shell">
      <div className="settings-header-row">
        <h3 className="panel-title">Providers</h3>
        <button className="btn outline" onClick={props.onRefresh} type="button" disabled={props.isLoading}>
          {props.isLoading ? "Loading..." : "Reload"}
        </button>
      </div>

      <div className="providers-selected-card">
        <div>Текущий провайдер: {props.selected?.model.providerID ?? "—"}</div>
        <div>Модель: {props.selected?.model.modelID ?? "—"}</div>
        <div>Режим мышления: {props.selected?.thinking ?? "default"}</div>
        <div>Агент: {props.selected?.agent ?? "default"}</div>
      </div>

      <div className="providers-list">
        {connectedProviders.map((provider) => (
          <div key={provider.id} className="providers-item-card">
            <div className="providers-item-head">
              <span className="providers-item-name">{provider.name}</span>
              <span className="providers-badge connected">Connected</span>
            </div>
            <button
              className="btn ghost"
              onClick={() => props.onDisconnect(provider.id)}
              disabled={props.isSubmitting}
              type="button"
            >
              Disconnect
            </button>
          </div>
        ))}

        {connectedProviders.length === 0 ? (
          <div className="providers-empty">Пока нет подключенных провайдеров.</div>
        ) : null}
      </div>

      <button className="btn primary" onClick={() => setIsPickerOpen((prev) => !prev)} type="button">
        Добавить провайдера
      </button>

      {isPickerOpen ? (
        <>
          <input
            className="input settings-input-compact"
            placeholder="Поиск провайдера"
            value={providerSearch}
            onChange={(event) => setProviderSearch(event.target.value)}
          />

          <div className="providers-method-grid">
            {filteredConnectableProviders.map((provider) => {
            const methods = props.authMethods[provider.id] ?? [];
            return (
              <div key={`connect:${provider.id}`} className="providers-method-card">
                <button
                  className="btn outline providers-provider-btn"
                  onClick={() => {
                    if (methods.length > 0) {
                      props.onStartConnect({ providerID: provider.id, methodIndex: 0 });
                    }
                  }}
                  type="button"
                >
                  {provider.name}
                </button>
                {methods.length > 0
                  ? methods.map((method, index) => (
                      <button
                        key={`${provider.id}:${index}`}
                        className="btn"
                        onClick={() => props.onStartConnect({ providerID: provider.id, methodIndex: index })}
                        type="button"
                      >
                        {method.label}
                      </button>
                    ))
                  : null}
              </div>
            );
            })}

            {filteredConnectableProviders.length === 0 ? (
              <div className="providers-empty">Ничего не найдено. Уточните запрос.</div>
            ) : null}
          </div>
        </>
      ) : null}

      {props.oauthState && isApiFlow ? (
        <div className="providers-auth-card">
          <div className="project-create-note">
            API key для {providerMap.get(props.oauthState.providerID) ?? props.oauthState.providerID}
          </div>
          <input
            className="input settings-input-compact"
            placeholder="Введите API ключ"
            type="password"
            autoComplete="new-password"
            value={apiKeyDraft}
            onChange={(event) => setApiKeyDraft(event.target.value)}
          />
          <button
            className="btn primary"
            type="button"
            disabled={props.isSubmitting}
            onClick={() =>
              props.onSubmitApiKey({ providerID: props.oauthState?.providerID ?? "", key: apiKeyDraft })
            }
          >
            Подключить по API ключу
          </button>
        </div>
      ) : null}

      {props.oauthState && !isApiFlow ? (
        <div className="providers-auth-card">
          <div className="project-create-note">{props.oauthState.instructions}</div>
          <a className="btn outline" href={props.oauthState.url} target="_blank" rel="noreferrer">
            Открыть авторизацию
          </a>

          {props.oauthState.method === "auto" ? (
            <button
              className="btn primary"
              type="button"
              disabled={props.isSubmitting}
              onClick={props.onCompleteOAuthAuto}
            >
              Проверить подключение
            </button>
          ) : (
            <>
              <input
                className="input settings-input-compact"
                placeholder="Введите OAuth code"
                value={localCodeDraft}
                onChange={(event) => {
                  setLocalCodeDraft(event.target.value);
                  props.onChangeOAuthCodeDraft?.(event.target.value);
                }}
              />
              <button
                className="btn primary"
                type="button"
                disabled={props.isSubmitting}
                onClick={props.onSubmitOAuthCode}
              >
                Завершить OAuth
              </button>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
};
