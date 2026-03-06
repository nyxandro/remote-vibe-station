/**
 * @fileoverview Types for persisted CLI/Proxy runtime preferences.
 *
 * Exports:
 * - ProxyMode - Supported outbound traffic modes for AI requests.
 * - ProxySettingsRecord - Persisted settings record.
 * - ProxySettingsInput - Update payload accepted from Mini App.
 * - ProxySettingsSnapshot - API payload with env preview.
 * - ProxyApplyResult - Result payload after docker compose apply.
 */

export type ProxyMode = "direct" | "vless";

export type ProxySettingsRecord = {
  mode: ProxyMode;
  vlessProxyUrl: string | null;
  noProxy: string;
  updatedAt: string;
};

export type ProxySettingsInput = {
  mode: ProxyMode;
  vlessProxyUrl: string | null;
  noProxy: string;
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
    recommendedApplyCommand: string | null;
  };
};

export type ProxyApplyResult = {
  ok: true;
  command: string;
  stdout: string;
  stderr: string;
};
