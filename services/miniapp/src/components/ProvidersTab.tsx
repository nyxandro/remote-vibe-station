/**
 * @fileoverview Providers management tab with direct provider auth plus CLIProxy onboarding/runtime.
 *
 * Exports:
 * - ProvidersTab (L60) - Renders provider status, connect flows, CLIProxy accounts, and proxy runtime controls.
 */

import { useEffect, useMemo, useState } from "react";

import {
  CliproxyAccountState,
  CliproxyOAuthStartPayload,
  ProviderAuthMethod,
  ProxyApplyResult,
  ProxyEnabledService,
  ProxySettingsInput,
  ProxySettingsMode,
  ProxySettingsSnapshot,
  ProxySettingsTestResult
} from "../types";
import { ProviderOAuthState } from "../hooks/use-provider-auth";
import { CliproxyAccountsSection } from "./CliproxyAccountsSection";
import { PROVIDERS_TAB_FIELD_IDS } from "./providers-tab-field-ids";

const CLIPROXY_PROVIDER_ID = "cliproxy";
const DEFAULT_PROXY_ENABLED_SERVICES: ProxyEnabledService[] = ["bot", "cliproxy", "opencode"];
const PROXY_SERVICE_OPTIONS: Array<{ id: ProxyEnabledService; label: string }> = [
  { id: "bot", label: "Telegram bot" },
  { id: "opencode", label: "OpenCode" },
  { id: "cliproxy", label: "CLIProxy" }
];

type Props = {
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
  isProxyTesting: boolean;
  proxyApplyResult: ProxyApplyResult | null;
  proxyTestResult: ProxySettingsTestResult | null;
  onRefresh?: () => void;
  onStartConnect: (input: { providerID: string; methodIndex: number }) => void;
  onSubmitApiKey: (input: { providerID: string; key: string }) => void;
  onSubmitOAuthCode: () => void;
  onCompleteOAuthAuto: () => void;
  onDisconnect: (providerID: string) => void;
  onChangeOAuthCodeDraft?: (value: string) => void;
  onReloadCliproxy?: () => void;
  onStartCliproxyAuth: (provider: CliproxyAccountState["providers"][number]["id"]) => void;
  onCloseCliproxyAuthModal: () => void;
  onCompleteCliproxyAuth: (input: {
    provider: CliproxyAccountState["providers"][number]["id"];
    callbackUrl?: string;
    code?: string;
    state?: string;
    error?: string;
  }) => void;
  onTestCliproxyAccount: (accountId: string) => void;
  onActivateCliproxyAccount: (accountId: string) => void;
  onDeleteCliproxyAccount: (accountId: string) => Promise<void> | void;
  onReloadProxy?: () => void;
  onSaveProxy: (input: ProxySettingsInput) => void;
  onTestProxy: (input: { vlessConfigUrl: string }) => void;
  onApplyProxy: () => void;
};

export const ProvidersTab = (props: Props) => {
  const [isPickerOpen, setIsPickerOpen] = useState<boolean>(false);
  const [apiKeyDraft, setApiKeyDraft] = useState<string>("");
  const [localCodeDraft, setLocalCodeDraft] = useState<string>(props.oauthState?.codeDraft ?? "");
  const [providerSearch, setProviderSearch] = useState<string>("");
  const [proxyMode, setProxyMode] = useState<ProxySettingsMode>("direct");
  const [vlessConfigUrl, setVlessConfigUrl] = useState<string>("");
  const [vlessProxyUrl, setVlessProxyUrl] = useState<string>("");
  const [enabledServices, setEnabledServices] = useState<ProxyEnabledService[]>(DEFAULT_PROXY_ENABLED_SERVICES);
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
  const hasSuccessfulProxyTest =
    proxyMode !== "vless"
      ? true
      : props.proxyTestResult?.ok === true && props.proxyTestResult.vlessProxyUrl === vlessProxyUrl && vlessConfigUrl.trim().length > 0;
  const isProxySaveDisabled =
    props.isProxySaving ||
    (proxyMode === "vless" && (vlessConfigUrl.trim().length === 0 || vlessProxyUrl.trim().length === 0 || !hasSuccessfulProxyTest));

  useEffect(() => {
    /* Mirror persisted proxy runtime profile into local draft controls after every reload. */
    if (!props.proxySnapshot) {
      return;
    }
    setProxyMode(props.proxySnapshot.mode);
    setVlessConfigUrl(props.proxySnapshot.vlessConfigUrl ?? "");
    setVlessProxyUrl(props.proxySnapshot.vlessProxyUrl ?? "");
    setEnabledServices(props.proxySnapshot.enabledServices);
  }, [props.proxySnapshot]);

  useEffect(() => {
    /* Successful test derives the local proxy URL used by saved env preview and compose override. */
    if (!props.proxyTestResult) {
      return;
    }
    setVlessProxyUrl(props.proxyTestResult.vlessProxyUrl);
  }, [props.proxyTestResult]);

  const toggleEnabledService = (serviceId: ProxyEnabledService) => {
    /* Preserve explicit service selection instead of inferring hidden defaults from runtime. */
    setEnabledServices((current) => {
      if (current.includes(serviceId)) {
        return current.filter((entry) => entry !== serviceId);
      }
      return [...current, serviceId].sort();
    });
  };

  const cliproxyUpdatedAtLabel = useMemo(() => {
    /* Keep runtime metadata readable even when backend has not loaded snapshot yet. */
    if (!props.proxySnapshot) {
      return "(unknown date)";
    }
    const parsed = new Date(props.proxySnapshot.updatedAt);
    return Number.isNaN(parsed.getTime()) ? "(unknown date)" : parsed.toLocaleString();
  }, [props.proxySnapshot]);

  return (
    <section className="providers-shell">
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
            id={PROVIDERS_TAB_FIELD_IDS.providerSearch}
            name={PROVIDERS_TAB_FIELD_IDS.providerSearch}
            aria-label="Поиск провайдера"
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

      <CliproxyAccountsSection
        accounts={props.cliproxyAccounts}
        oauthStart={props.cliproxyOAuthStart}
        isLoading={props.isCliproxyLoading}
        isSubmitting={props.isCliproxySubmitting}
        onReload={props.onReloadCliproxy}
        onStartAuth={props.onStartCliproxyAuth}
        onCloseAuthModal={props.onCloseCliproxyAuthModal}
        onCompleteAuth={props.onCompleteCliproxyAuth}
        onTestAccount={props.onTestCliproxyAccount}
        onActivateAccount={props.onActivateCliproxyAccount}
        onDeleteAccount={props.onDeleteCliproxyAccount}
      />

      <div className="providers-auth-card">
        {/* Proxy runtime controls stay available here after removing the dedicated CLIProxy tab. */}
        <div className="settings-header-row">
          <strong>CLIProxy runtime</strong>
        </div>

        <label className="project-create-note" htmlFor={PROVIDERS_TAB_FIELD_IDS.proxyMode}>
          Outbound mode
        </label>
        <select
          id={PROVIDERS_TAB_FIELD_IDS.proxyMode}
          name={PROVIDERS_TAB_FIELD_IDS.proxyMode}
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
            <label className="project-create-note" htmlFor={PROVIDERS_TAB_FIELD_IDS.vlessConfigUrl}>
              VLESS config URL
            </label>
            <input
              id={PROVIDERS_TAB_FIELD_IDS.vlessConfigUrl}
              name={PROVIDERS_TAB_FIELD_IDS.vlessConfigUrl}
              aria-label="VLESS config URL"
              className="input settings-input-compact"
              placeholder="vless://uuid@example.com:443?..."
              value={vlessConfigUrl}
              onChange={(event) => {
                setVlessConfigUrl(event.target.value);
                setVlessProxyUrl("");
              }}
            />
            <div className="settings-actions-grid">
              <button
                className="btn outline"
                onClick={() => props.onTestProxy({ vlessConfigUrl: vlessConfigUrl.trim() })}
                disabled={props.isProxyTesting || vlessConfigUrl.trim().length === 0}
                type="button"
              >
                {props.isProxyTesting ? "Testing..." : "Test config"}
              </button>
            </div>
            <div className="project-create-note">
              Derived local proxy URL: {vlessProxyUrl || "(run test first)"}
            </div>
            {props.proxyTestResult ? <div className="project-create-note">Test result: {props.proxyTestResult.summary}</div> : null}
            <div className="providers-list">
              {PROXY_SERVICE_OPTIONS.map((service) => {
                const checked = enabledServices.includes(service.id);
                return (
                  <label key={service.id} className="project-create-note" htmlFor={`proxy-service-${service.id}`}>
                    <input
                      id={`proxy-service-${service.id}`}
                      aria-label={`Use VLESS for ${service.label}`}
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleEnabledService(service.id)}
                    />{" "}
                    {service.label}
                  </label>
                );
              })}
            </div>
            <div className="project-create-note">
              Recommended for blocked outbound traffic: Telegram bot, CLIProxy, and OpenCode if it talks to models directly.
            </div>
          </>
        ) : null}

        <div className="settings-actions-grid">
          <button
            className="btn primary"
            onClick={() =>
              props.onSaveProxy({
                mode: proxyMode,
                vlessProxyUrl: proxyMode === "vless" ? vlessProxyUrl.trim() : null,
                vlessConfigUrl: proxyMode === "vless" ? vlessConfigUrl.trim() : null,
                enabledServices: proxyMode === "vless" ? enabledServices : DEFAULT_PROXY_ENABLED_SERVICES
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
            {props.proxySnapshot.runtimeFiles.xrayConfigPath ? (
              <div className="project-create-note">Generated xray.json: {props.proxySnapshot.runtimeFiles.xrayConfigPath}</div>
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
            id={PROVIDERS_TAB_FIELD_IDS.apiKey}
            name={PROVIDERS_TAB_FIELD_IDS.apiKey}
            aria-label="API key"
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
                id={PROVIDERS_TAB_FIELD_IDS.oauthCode}
                name={PROVIDERS_TAB_FIELD_IDS.oauthCode}
                aria-label="OAuth code"
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
