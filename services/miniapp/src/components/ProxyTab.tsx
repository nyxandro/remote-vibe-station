/**
 * @fileoverview Dedicated CLI/Proxy tab for account onboarding and transport settings.
 *
 * Exports:
 * - ProxyTab - Renders CLIProxy account connections plus VLESS/direct runtime controls.
 */

import { useEffect, useMemo, useState } from "react";

import {
  CliproxyAccountState,
  CliproxyOAuthStartPayload,
  CliproxyProviderState,
  ProxyApplyResult,
  ProxySettingsInput,
  ProxySettingsMode,
  ProxySettingsSnapshot
} from "../types";

type Props = {
  snapshot: ProxySettingsSnapshot | null;
  isLoading: boolean;
  isSaving: boolean;
  isApplying: boolean;
  applyResult: ProxyApplyResult | null;
  cliproxyAccounts: CliproxyAccountState | null;
  cliproxyOAuthStart: CliproxyOAuthStartPayload | null;
  isCliproxyLoading: boolean;
  isCliproxySubmitting: boolean;
  onReload: () => void;
  onSave: (input: ProxySettingsInput) => void;
  onApply: () => void;
  onReloadCliproxy: () => void;
  onStartCliproxyAuth: (provider: CliproxyProviderState["id"]) => void;
  onCompleteCliproxyAuth: (input: {
    provider: CliproxyProviderState["id"];
    callbackUrl?: string;
    code?: string;
    state?: string;
    error?: string;
  }) => void;
};

export const ProxyTab = (props: Props) => {
  const [mode, setMode] = useState<ProxySettingsMode>("direct");
  const [vlessProxyUrl, setVlessProxyUrl] = useState<string>("");
  const [noProxy, setNoProxy] = useState<string>("localhost,127.0.0.1,backend,opencode,cliproxy");
  const [callbackUrlDraft, setCallbackUrlDraft] = useState<string>("");
  const [codeDraft, setCodeDraft] = useState<string>("");
  const [stateDraft, setStateDraft] = useState<string>("");

  useEffect(() => {
    /* Mirror persisted backend profile into local draft fields on every snapshot refresh. */
    if (!props.snapshot) {
      return;
    }
    setMode(props.snapshot.mode);
    setVlessProxyUrl(props.snapshot.vlessProxyUrl ?? "");
    setNoProxy(props.snapshot.noProxy);
  }, [props.snapshot]);

  useEffect(() => {
    /* New OAuth attempt must reset stale callback/code drafts from previous provider attempts. */
    setCallbackUrlDraft("");
    setCodeDraft("");
    setStateDraft(props.cliproxyOAuthStart?.state ?? "");
  }, [props.cliproxyOAuthStart]);

  const onSave = (): void => {
    /* Persist transport mode as explicit runtime profile in backend store. */
    props.onSave({
      mode,
      vlessProxyUrl: mode === "vless" ? vlessProxyUrl.trim() : null,
      noProxy: noProxy.trim()
    });
  };

  const updatedAtLabel = useMemo(() => {
    /* Prevent showing Invalid Date when timestamp is absent or malformed. */
    if (!props.snapshot) {
      return "(unknown date)";
    }
    const parsed = new Date(props.snapshot.updatedAt);
    return Number.isNaN(parsed.getTime()) ? "(unknown date)" : parsed.toLocaleString();
  }, [props.snapshot]);

  const selectedProvider = props.cliproxyOAuthStart?.provider;

  return (
    <section className="providers-shell">
      <div className="settings-header-row">
        <h3 className="panel-title">CLI/Proxy</h3>
        <button className="btn outline" onClick={props.onReload} disabled={props.isLoading} type="button">
          {props.isLoading ? "Loading..." : "Reload"}
        </button>
      </div>

      <div className="providers-selected-card">
        <div>Здесь подключаются аккаунты внутри CLIProxy (Codex/Claude/Antigravity и другие).</div>
        <div>Вкладка Providers остается для прямых провайдеров моделей (без CLIProxy).</div>
      </div>

      <div className="providers-auth-card">
        {/* Account state is loaded from CLIProxy management API, not from OpenCode provider-auth methods. */}
        <div className="settings-header-row">
          <strong>Аккаунты CLIProxy</strong>
          <button
            className="btn outline"
            onClick={props.onReloadCliproxy}
            disabled={props.isCliproxyLoading}
            type="button"
          >
            {props.isCliproxyLoading ? "Loading..." : "Reload accounts"}
          </button>
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
          {!props.cliproxyAccounts || props.cliproxyAccounts.providers.length === 0 ? (
            <div className="providers-empty">Список аккаунтов пока не загружен.</div>
          ) : null}
        </div>

        {props.cliproxyOAuthStart ? (
          <>
            {/* OAuth handoff gives URL+state; user returns callback URL or copies code/state manually. */}
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
              disabled={props.isCliproxySubmitting || !selectedProvider}
              onClick={() => {
                if (!selectedProvider) {
                  return;
                }
                props.onCompleteCliproxyAuth({
                  provider: selectedProvider,
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

      <div className="placeholder">Runtime-параметры CLIProxy/VLESS управляются через runtime compose/env на сервере.</div>

      <div className="providers-auth-card">
        {/* Transport controls remain separate from account onboarding to avoid config ambiguity. */}
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
