/**
 * @fileoverview Dedicated CLI/Proxy workspace tab with operational guidance.
 *
 * Exports:
 * - ProxyTab - Renders separate section for CLIProxy/VLESS mode management.
 */

import { useEffect, useState } from "react";

import { ProxyApplyResult, ProxySettingsInput, ProxySettingsMode, ProxySettingsSnapshot } from "../types";

type Props = {
  snapshot: ProxySettingsSnapshot | null;
  isLoading: boolean;
  isSaving: boolean;
  isApplying: boolean;
  applyResult: ProxyApplyResult | null;
  onReload: () => void;
  onSave: (input: ProxySettingsInput) => void;
  onApply: () => void;
};

export const ProxyTab = (props: Props) => {
  const [mode, setMode] = useState<ProxySettingsMode>("direct");
  const [vlessProxyUrl, setVlessProxyUrl] = useState<string>("");
  const [noProxy, setNoProxy] = useState<string>("localhost,127.0.0.1,backend,opencode,cliproxy");

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

  return (
    <section className="providers-shell">
      <div className="settings-header-row">
        <h3 className="panel-title">CLI/Proxy</h3>
        <button className="btn outline" onClick={props.onReload} disabled={props.isLoading} type="button">
          {props.isLoading ? "Loading..." : "Reload"}
        </button>
      </div>

      <div className="providers-selected-card">
        <div>Этот раздел выделен отдельно от провайдеров моделей.</div>
        <div>Используйте вкладку Providers для подключения моделей напрямую (без CLIProxy).</div>
      </div>

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
