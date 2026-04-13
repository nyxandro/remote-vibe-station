/**
 * @fileoverview Types for persisted CLI/Proxy runtime preferences.
 *
 * Exports:
 * - ProxyMode - Supported outbound traffic modes for AI requests.
 * - ProxyEnabledService - Runtime services that can be attached to VLESS proxy env.
 * - ProxySettingsRecord - Persisted settings record.
 * - ProxySettingsInput - Update payload accepted from Mini App.
 * - ProxySettingsSnapshot - API payload with env preview.
 * - ProxySettingsTestInput - Validation payload for pasted VLESS config URLs.
 * - ProxySettingsTestResult - Derived runtime proxy info returned by pre-save validation.
 * - ProxyApplyResult - Result payload after docker compose apply.
 */

export type ProxyMode = "direct" | "vless";

export type ProxyEnabledService = "bot" | "opencode" | "cliproxy";

export type ProxySettingsRecord = {
  mode: ProxyMode;
  vlessProxyUrl: string | null;
  vlessConfigUrl: string | null;
  enabledServices: ProxyEnabledService[];
  noProxy: string;
  updatedAt: string;
};

export type ProxySettingsInput = {
  mode: ProxyMode;
  vlessProxyUrl: string | null;
  vlessConfigUrl: string | null;
  enabledServices: ProxyEnabledService[];
};

export type ProxySettingsTestInput = {
  vlessConfigUrl: string;
};

export type ProxySettingsTestResult = {
  ok: true;
  vlessProxyUrl: string;
  summary: string;
};

export type ProxySettingsSnapshot = ProxySettingsRecord & {
  envPreview: {
    HTTP_PROXY: string | null;
    HTTPS_PROXY: string | null;
    ALL_PROXY: string | null;
    NO_PROXY: string;
  };
  runtimeFiles: {
    runtimeConfigDir: string | null;
    proxyEnvPath: string | null;
    overridePath: string | null;
    xrayConfigPath: string | null;
    recommendedApplyCommand: string | null;
  };
};

export type ProxyApplyResult = {
  ok: true;
  command: string;
  stdout: string;
  stderr: string;
};
