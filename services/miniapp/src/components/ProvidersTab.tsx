/**
 * @fileoverview Providers management tab with direct provider auth plus CLIProxy onboarding/runtime.
 *
 * Exports:
 * - ProvidersTab (L60) - Renders provider status, connect flows, CLIProxy accounts, and proxy runtime controls.
 */

import { useEffect, useMemo, useState } from "react";

import { CliproxyAccountState, CliproxyOAuthStartPayload, ProviderAuthMethod, ProxyApplyResult, ProxySettingsInput, ProxySettingsMode, ProxySettingsSnapshot } from "../types";
import { ProviderOAuthState } from "../hooks/use-provider-auth";

const CLIPROXY_PROVIDER_ID = "cliproxy";

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
  cliproxyAccounts: CliproxyAccountState | null;
  cliproxyOAuthStart: CliproxyOAuthStartPayload | null;
  isCliproxyLoading: boolean;
  isCliproxySubmitting: boolean;
  proxySnapshot: ProxySettingsSnapshot | null;
  isProxyLoading: boolean;
  isProxySaving: boolean;
  isProxyApplying: boolean;
  proxyApplyResult: ProxyApplyResult | null;
  onRefresh: () => void;
  onStartConnect: (input: { providerID: string; methodIndex: number }) => void;
  onSubmitApiKey: (input: { providerID: string; key: string }) => void;
  onSubmitOAuthCode: () => void;
  onCompleteOAuthAuto: () => void;
  onDisconnect: (providerID: string) => void;
  onChangeOAuthCodeDraft?: (value: string) => void;
  onReloadCliproxy: () => void;
  onStartCliproxyAuth: (provider: CliproxyAccountState["providers"][number]["id"]) => void;
  onCompleteCliproxyAuth: (input: {
    provider: CliproxyAccountState["providers"][number]["id"];
    callbackUrl?: string;
    code?: string;
    state?: string;
    error?: string;
  }) => void;
  onReloadProxy: () => void;
  onSaveProxy: (input: ProxySettingsInput) => void;
  onApplyProxy: () => void;
};

export const ProvidersTab = (props: Props) => {
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);
  const [apiKeyDraft, setApiKeyDraft] = useState<string>("");
  const [localCodeDraft, setLocalCodeDraft] = useState<string>(props.oauthState?.codeDraft ?? "");
  const [providerSearch, setProviderSearch] = useState<string>("");
  const [proxyMode, setProxyMode] = useState<ProxySettingsMode>("direct");
  const [vlessProxyUrl, setVlessProxyUrl] = useState<string>("");
  const [noProxy, setNoProxy] = useState<string>("localhost,127.0.0.1,backend,opencode,cliproxy");
  const [callbackUrlDraft, setCallbackUrlDraft] = useState<string>("");
  const [codeDraft, setCodeDraft] = useState<string>("");
  const [stateDraft, setStateDraft] = useState<string>("");

  const providerMap = useMemo(() => {
    /* Keep O(1) lookup for provider labels in connect modal and oauth forms. */
    return new Map(props.providers.map((item) => [item.id, item.name]));
  }, [props.providers]);

  const connectedProviders = useMemo(() => {
    /* Keep generic provider cards separate from CLIProxy-managed accounts shown below. */
    return props.providers.filter((provider) => provider.connected && provider.id !== CLIPROXY_PROVIDER_ID);
  }, [props.providers]);

  const connectableProviders = useMemo(() => {
    /* CLIProxy onboarding is rendered in its own section inside this tab, not in the generic picker. */
    return props.providers.filter((provider) => !provider.connected && provider.id !== CLIPROXY_PROVIDER_ID);
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
  const isProxySaveDisabled =
    props.isProxySaving || (proxyMode === "vless" && vlessProxyUrl.trim().length === 0);

  useEffect(() => {
    /* Mirror persisted proxy runtime profile into local draft controls after every reload. */
    if (!props.proxySnapshot) {
      return;
    }
    setProxyMode(props.proxySnapshot.mode);
    setVlessProxyUrl(props.proxySnapshot.vlessProxyUrl ?? "");
    setNoProxy(props.proxySnapshot.noProxy);
  }, [props.proxySnapshot]);

  useEffect(() => {
    /* New CLIProxy auth flow must clear stale callback/code values from previous provider attempts. */
    setCallbackUrlDraft("");
    setCodeDraft("");
    setStateDraft(props.cliproxyOAuthStart?.state ?? "");
  }, [props.cliproxyOAuthStart]);

  const selectedCliproxyProvider = props.cliproxyOAuthStart?.provider;
  const cliproxyUpdatedAtLabel = useMemo(() => {
    /* Keep runtime metadata readable even when backend has not loaded snapshot yet. */
    if (!props.proxySnapshot) {
      return "(unknown date)";
    }
    const parsed = new Date(props.proxySnapshot.updatedAt);
    return Number.isNaN(parsed.getTime()) ? "(unknown date)" : parsed.toLocaleString();
  }, [props.proxySnapshot]);

  const getCliproxyAccountDetails = (account: CliproxyAccountState["accounts"][number]): string[] => {
    /* CLIProxy may repeat the same identity in email/account/label/status fields, so collapse duplicates for readable cards. */
    const uniqueDetails = new Set<string>();

    [account.email ?? account.name, account.account, account.label, account.statusMessage].forEach((value) => {
      const normalized = String(value ?? "").trim();
      if (normalized) {
        uniqueDetails.add(normalized);
      }
    });

    return Array.from(uniqueDetails);
  };

  const maxTrackedTokens = useMemo(() => {
    /* Relative bar uses the busiest observed account as 100% to avoid implying provider quota availability. */
    return Math.max(0, ...(props.cliproxyAccounts?.accounts ?? []).map((account) => account.usage.tokenCount));
  }, [props.cliproxyAccounts]);

  const formatUsageNumber = (value: number): string => {
    /* Keep token and request counts compact and locale-aware for quick scanning on mobile. */
    return new Intl.NumberFormat("en-US").format(Math.max(0, Math.trunc(value)));
  };

  const formatUsageDate = (value: string | null): string => {
    /* Empty timestamps should read as no activity yet instead of rendering Invalid Date. */
    if (!value) {
      return "еще нет";
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "еще нет" : parsed.toLocaleString();
  };

  const getUsageActivityPercent = (account: CliproxyAccountState["accounts"][number]): number => {
    /* This bar shows observed activity relative to the busiest connected account, not remaining provider quota. */
    if (maxTrackedTokens <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round((account.usage.tokenCount / maxTrackedTokens) * 100)));
  };

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

      <div className="providers-auth-card">
        {/* CLIProxy account onboarding now lives here so provider management stays in one place. */}
        <div className="settings-header-row">
          <strong>CLIProxy accounts</strong>
          <button className="btn outline" onClick={props.onReloadCliproxy} disabled={props.isCliproxyLoading} type="button">
            {props.isCliproxyLoading ? "Loading..." : "Reload accounts"}
          </button>
        </div>

        <div className="project-create-note">
          Здесь отображаются аккаунты, уже подключенные внутри CLIProxy, и отсюда же запускается новая авторизация.
        </div>

        {!props.cliproxyAccounts?.usageTrackingEnabled ? (
          <div className="project-create-note">
            CLIProxy: наблюдаемая статистика usage выключена, поэтому активность по аккаунтам пока не собирается.
          </div>
        ) : null}

        <div className="providers-list">
          {props.cliproxyAccounts?.accounts.map((account) => (
            <div key={`cliproxy-account:${account.id}`} className="providers-item-card">
              <div className="providers-item-head">
                <span className="providers-item-name">{account.providerLabel}</span>
                <span className="providers-badge connected">{account.status ?? "connected"}</span>
              </div>
              {/* Render each human-readable identity/detail only once even if CLIProxy duplicates it across fields. */}
              {getCliproxyAccountDetails(account).map((detail) => (
                <div key={`${account.id}:${detail}`} className="project-create-note">
                  {detail}
                </div>
              ))}

              {/* Observed activity is sourced from CLIProxy usage stats and intentionally labeled as usage, not quota. */}
              <div className="project-create-note">Запросы: {formatUsageNumber(account.usage.requestCount)}</div>
              <div className="project-create-note">Токены: {formatUsageNumber(account.usage.tokenCount)}</div>
              <div className="project-create-note">Ошибки: {formatUsageNumber(account.usage.failedRequestCount)}</div>
              <div className="project-create-note">Последняя активность: {formatUsageDate(account.usage.lastUsedAt)}</div>
              {account.usage.models.length > 0 ? (
                <div className="project-create-note">Модели: {account.usage.models.join(", ")}</div>
              ) : null}
              {props.cliproxyAccounts?.usageTrackingEnabled ? (
                <>
                  <div className="project-create-note">
                    Относительная активность: {getUsageActivityPercent(account)}% от самого активного аккаунта
                  </div>
                  <progress max={100} value={getUsageActivityPercent(account)} />
                </>
              ) : null}
            </div>
          ))}

          {!props.cliproxyAccounts || props.cliproxyAccounts.accounts.length === 0 ? (
            <div className="providers-empty">Пока нет подключенных CLIProxy аккаунтов.</div>
          ) : null}
        </div>

        <div className="providers-list">
          {(props.cliproxyAccounts?.providers ?? []).map((provider) => (
            <div key={`cliproxy-provider:${provider.id}`} className="providers-item-card">
              <div className="providers-item-head">
                <span className="providers-item-name">{provider.label}</span>
                <span className={`providers-badge ${provider.connected ? "connected" : "disconnected"}`}>
                  {provider.connected ? "Connected" : "Disconnected"}
                </span>
              </div>
              <button
                className="btn outline"
                type="button"
                disabled={props.isCliproxySubmitting}
                onClick={() => props.onStartCliproxyAuth(provider.id)}
              >
                Подключить / обновить
              </button>
            </div>
          ))}
        </div>

        {props.cliproxyOAuthStart ? (
          <>
            {/* Completion accepts pasted callback URL or raw code/state for provider-specific OAuth flows. */}
            <div className="project-create-note">Provider: {props.cliproxyOAuthStart.provider}</div>
            <div className="project-create-note">{props.cliproxyOAuthStart.instructions}</div>
            <a className="btn outline" href={props.cliproxyOAuthStart.url} target="_blank" rel="noreferrer">
              Открыть авторизацию
            </a>

            <input
              className="input settings-input-compact"
              placeholder="Вставьте callback URL целиком"
              value={callbackUrlDraft}
              onChange={(event) => setCallbackUrlDraft(event.target.value)}
            />
            <input
              className="input settings-input-compact"
              placeholder="Или отдельно code"
              value={codeDraft}
              onChange={(event) => setCodeDraft(event.target.value)}
            />
            <input
              className="input settings-input-compact"
              placeholder="state"
              value={stateDraft}
              onChange={(event) => setStateDraft(event.target.value)}
            />

            <button
              className="btn primary"
              type="button"
              disabled={props.isCliproxySubmitting || !selectedCliproxyProvider}
              onClick={() => {
                if (!selectedCliproxyProvider) {
                  return;
                }
                props.onCompleteCliproxyAuth({
                  provider: selectedCliproxyProvider,
                  callbackUrl: callbackUrlDraft.trim() || undefined,
                  code: codeDraft.trim() || undefined,
                  state: stateDraft.trim() || undefined
                });
              }}
            >
              {props.isCliproxySubmitting ? "Submitting..." : "Завершить подключение"}
            </button>
          </>
        ) : null}
      </div>

      <div className="providers-auth-card">
        {/* Proxy runtime controls stay available here after removing the dedicated CLIProxy tab. */}
        <div className="settings-header-row">
          <strong>CLIProxy runtime</strong>
          <button className="btn outline" onClick={props.onReloadProxy} disabled={props.isProxyLoading} type="button">
            {props.isProxyLoading ? "Loading..." : "Reload runtime"}
          </button>
        </div>

        <label className="project-create-note" htmlFor="proxy-mode-select">
          Outbound mode
        </label>
        <select
          id="proxy-mode-select"
          aria-label="Outbound mode"
          className="input settings-input-compact"
          value={proxyMode}
          onChange={(event) => setProxyMode(event.target.value as ProxySettingsMode)}
        >
          <option value="direct">direct</option>
          <option value="vless">vless</option>
        </select>

        {proxyMode === "vless" ? (
          <>
            <label className="project-create-note" htmlFor="vless-proxy-url-input">
              VLESS proxy URL
            </label>
            <input
              id="vless-proxy-url-input"
              aria-label="VLESS proxy URL"
              className="input settings-input-compact"
              placeholder="http://vless-proxy:8080"
              value={vlessProxyUrl}
              onChange={(event) => setVlessProxyUrl(event.target.value)}
            />
          </>
        ) : null}

        <label className="project-create-note" htmlFor="no-proxy-input">
          NO_PROXY
        </label>
        <input
          id="no-proxy-input"
          aria-label="NO_PROXY"
          className="input settings-input-compact"
          value={noProxy}
          onChange={(event) => setNoProxy(event.target.value)}
        />

        <div className="settings-actions-grid">
          <button
            className="btn primary"
            onClick={() =>
              props.onSaveProxy({
                mode: proxyMode,
                vlessProxyUrl: proxyMode === "vless" ? vlessProxyUrl.trim() : null,
                noProxy: noProxy.trim()
              })
            }
            disabled={isProxySaveDisabled}
            type="button"
          >
            {props.isProxySaving ? "Saving..." : "Save proxy settings"}
          </button>
          <button className="btn outline" onClick={props.onApplyProxy} disabled={props.isProxyApplying} type="button">
            {props.isProxyApplying ? "Applying..." : "Apply runtime now"}
          </button>
        </div>

        {props.proxySnapshot ? (
          <>
            <div className="project-create-note">Updated: {cliproxyUpdatedAtLabel}</div>
            <div className="project-create-note">HTTP_PROXY: {props.proxySnapshot.envPreview.HTTP_PROXY ?? "(disabled)"}</div>
            <div className="project-create-note">HTTPS_PROXY: {props.proxySnapshot.envPreview.HTTPS_PROXY ?? "(disabled)"}</div>
            <div className="project-create-note">ALL_PROXY: {props.proxySnapshot.envPreview.ALL_PROXY ?? "(disabled)"}</div>
            <div className="project-create-note">NO_PROXY: {props.proxySnapshot.envPreview.NO_PROXY ?? "(disabled)"}</div>
            <div className="project-create-note">Runtime dir: {props.proxySnapshot.runtimeFiles.runtimeConfigDir ?? "(not mounted in backend container)"}</div>
            {props.proxySnapshot.runtimeFiles.proxyEnvPath ? (
              <div className="project-create-note">Generated proxy.env: {props.proxySnapshot.runtimeFiles.proxyEnvPath}</div>
            ) : null}
            {props.proxySnapshot.runtimeFiles.overridePath ? (
              <div className="project-create-note">Generated override: {props.proxySnapshot.runtimeFiles.overridePath}</div>
            ) : null}
            {props.proxySnapshot.runtimeFiles.recommendedApplyCommand ? (
              <div className="project-create-note">Apply command: {props.proxySnapshot.runtimeFiles.recommendedApplyCommand}</div>
            ) : null}
            {props.proxyApplyResult ? <div className="project-create-note">Last apply: ok</div> : null}
          </>
        ) : null}
      </div>

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
