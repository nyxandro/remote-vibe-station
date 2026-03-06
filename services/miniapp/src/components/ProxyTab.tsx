/**
 * @fileoverview Dedicated CLI/Proxy workspace tab with operational guidance.
 *
 * Exports:
 * - ProxyTab - Renders separate section for CLIProxy/VLESS mode management.
 */

import { useEffect, useState } from "react";

import { ProxyApplyResult, ProxySettingsInput, ProxySettingsMode, ProxySettingsSnapshot, ProviderAuthMethod } from "../types";

type Props = {
  snapshot: ProxySettingsSnapshot | null;
  isLoading: boolean;
  isSaving: boolean;
  isApplying: boolean;
  applyResult: ProxyApplyResult | null;
  cliproxyConnected: boolean;
  cliproxyMethods: ProviderAuthMethod[];
  cliproxyOAuthState: {
    providerID: string;
    methodIndex: number;
    method: "auto" | "code";
    url: string;
    instructions: string;
    codeDraft: string;
  } | null;
  isProviderSubmitting: boolean;
  onReload: () => void;
  onSave: (input: ProxySettingsInput) => void;
  onApply: () => void;
  onStartCliproxyConnect: (methodIndex: number) => void;
  onSubmitCliproxyApiKey: (key: string) => void;
  onSubmitCliproxyOAuthCode: () => void;
  onCompleteCliproxyOAuthAuto: () => void;
  onDisconnectCliproxy: () => void;
  onChangeCliproxyCodeDraft: (value: string) => void;
};

export const ProxyTab = (props: Props) => {
  const [mode, setMode] = useState<ProxySettingsMode>("direct");
  const [vlessProxyUrl, setVlessProxyUrl] = useState<string>("");
  const [noProxy, setNoProxy] = useState<string>("localhost,127.0.0.1,backend,opencode,cliproxy");
  const [cliproxyApiKeyDraft, setCliproxyApiKeyDraft] = useState<string>("");

  useEffect(() => {
    /* Mirror persisted backend profile into local form draft when payload changes. */
    if (!props.snapshot) {
      return;
    }
    setMode(props.snapshot.mode);
    setVlessProxyUrl(props.snapshot.vlessProxyUrl ?? "");
    setNoProxy(props.snapshot.noProxy);
  }, [props.snapshot]);

  const onSave = (): void => {
    /* Enforce explicit payload shape before calling backend save endpoint. */
    props.onSave({
      mode,
      vlessProxyUrl: mode === "vless" ? vlessProxyUrl.trim() : null,
      noProxy: noProxy.trim()
    });
  };

  const updatedAtLabel = (() => {
    /* Prevent leaking "Invalid Date" text if backend timestamp is malformed. */
    if (!props.snapshot) {
      return "(unknown date)";
    }

    const parsed = new Date(props.snapshot.updatedAt);
    return Number.isNaN(parsed.getTime()) ? "(unknown date)" : parsed.toLocaleString();
  })();

  const isCliproxyApiFlow = props.cliproxyOAuthState?.instructions === "api";

  return (
    <section className="providers-shell">
      <div className="settings-header-row">
        <h3 className="panel-title">CLI/Proxy</h3>
        <button className="btn outline" onClick={props.onReload} disabled={props.isLoading} type="button">
          {props.isLoading ? "Loading..." : "Reload"}
        </button>
      </div>

      <div className="providers-selected-card">
        <div>CLIProxy аккаунты подключаются здесь.</div>
        <div>Вкладка Providers остается для прямых провайдеров моделей (без CLIProxy).</div>
      </div>

      <div className="providers-item-card">
        {/* Keep dedicated CLIProxy account status and onboarding actions in this tab only. */}
        <div className="providers-item-head">
          <span className="providers-item-name">CLIProxy</span>
          <span className={`providers-badge ${props.cliproxyConnected ? "connected" : "disconnected"}`}>
            {props.cliproxyConnected ? "Connected" : "Disconnected"}
          </span>
        </div>

        {props.cliproxyConnected ? (
          <button
            className="btn ghost"
            type="button"
            onClick={props.onDisconnectCliproxy}
            disabled={props.isProviderSubmitting}
          >
            Disconnect
          </button>
        ) : (
          <div className="providers-method-grid">
            {props.cliproxyMethods.map((method, index) => (
              <button
                key={`cliproxy-method:${index}`}
                className="btn outline"
                type="button"
                disabled={props.isProviderSubmitting}
                onClick={() => props.onStartCliproxyConnect(index)}
              >
                {method.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {props.cliproxyOAuthState && isCliproxyApiFlow ? (
        <div className="providers-auth-card">
          {/* API flow keeps key entry scoped to CLIProxy provider only. */}
          <div className="project-create-note">API key для CLIProxy</div>
          <input
            className="input settings-input-compact"
            placeholder="Введите API ключ"
            type="password"
            autoComplete="new-password"
            value={cliproxyApiKeyDraft}
            onChange={(event) => setCliproxyApiKeyDraft(event.target.value)}
          />
          <button
            className="btn primary"
            type="button"
            disabled={props.isProviderSubmitting}
            onClick={() => props.onSubmitCliproxyApiKey(cliproxyApiKeyDraft)}
          >
            Подключить CLIProxy по API ключу
          </button>
        </div>
      ) : null}

      {props.cliproxyOAuthState && !isCliproxyApiFlow ? (
        <div className="providers-auth-card">
          {/* OAuth flow mirrors existing provider UX but remains within CLI/Proxy tab. */}
          <div className="project-create-note">{props.cliproxyOAuthState.instructions}</div>
          <a className="btn outline" href={props.cliproxyOAuthState.url} target="_blank" rel="noreferrer">
            Открыть авторизацию CLIProxy
          </a>

          {props.cliproxyOAuthState.method === "auto" ? (
            <button
              className="btn primary"
              type="button"
              disabled={props.isProviderSubmitting}
              onClick={props.onCompleteCliproxyOAuthAuto}
            >
              Проверить подключение
            </button>
          ) : (
            <>
              <input
                className="input settings-input-compact"
                placeholder="Введите OAuth code"
                value={props.cliproxyOAuthState.codeDraft}
                onChange={(event) => props.onChangeCliproxyCodeDraft(event.target.value)}
              />
              <button
                className="btn primary"
                type="button"
                disabled={props.isProviderSubmitting}
                onClick={props.onSubmitCliproxyOAuthCode}
              >
                Завершить OAuth
              </button>
            </>
          )}
        </div>
      ) : null}

      <div className="placeholder">
        Runtime-параметры CLIProxy/VLESS управляются через runtime compose/env конфиги на сервере.
      </div>

      <div className="providers-auth-card">
        <label className="project-create-note" htmlFor="proxy-mode-select">
          Outbound mode
        </label>
        <select
          id="proxy-mode-select"
          aria-label="Outbound mode"
          className="input settings-input-compact"
          value={mode}
          onChange={(event) => setMode(event.target.value as ProxySettingsMode)}
        >
          <option value="direct">direct</option>
          <option value="vless">vless</option>
        </select>

        {mode === "vless" ? (
          <>
            <label className="project-create-note" htmlFor="vless-proxy-url-input">
              VLESS proxy URL
            </label>
            <input
              id="vless-proxy-url-input"
              aria-label="VLESS proxy URL"
              className="input settings-input-compact"
              placeholder="socks5://vless-proxy:1080"
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
          <button className="btn primary" onClick={onSave} disabled={props.isSaving} type="button">
            {props.isSaving ? "Saving..." : "Save proxy settings"}
          </button>
          <button className="btn outline" onClick={props.onApply} disabled={props.isApplying} type="button">
            {props.isApplying ? "Applying..." : "Apply runtime now"}
          </button>
        </div>

        {props.snapshot ? (
          <>
            <div className="project-create-note">Updated: {updatedAtLabel}</div>
            <div className="project-create-note">HTTP_PROXY: {props.snapshot.envPreview.HTTP_PROXY ?? "(disabled)"}</div>
            <div className="project-create-note">HTTPS_PROXY: {props.snapshot.envPreview.HTTPS_PROXY ?? "(disabled)"}</div>
            <div className="project-create-note">ALL_PROXY: {props.snapshot.envPreview.ALL_PROXY ?? "(disabled)"}</div>
            <div className="project-create-note">NO_PROXY: {props.snapshot.envPreview.NO_PROXY ?? "(disabled)"}</div>
            <div className="project-create-note">
              Runtime dir: {props.snapshot.runtimeFiles.runtimeConfigDir ?? "(not mounted in backend container)"}
            </div>
            {props.snapshot.runtimeFiles.proxyEnvPath ? (
              <div className="project-create-note">Generated proxy.env: {props.snapshot.runtimeFiles.proxyEnvPath}</div>
            ) : null}
            {props.snapshot.runtimeFiles.overridePath ? (
              <div className="project-create-note">Generated override: {props.snapshot.runtimeFiles.overridePath}</div>
            ) : null}
            {props.snapshot.runtimeFiles.recommendedApplyCommand ? (
              <div className="project-create-note">Apply command: {props.snapshot.runtimeFiles.recommendedApplyCommand}</div>
            ) : null}
            {props.applyResult ? <div className="project-create-note">Last apply: ok</div> : null}
          </>
        ) : null}
      </div>
    </section>
  );
};
