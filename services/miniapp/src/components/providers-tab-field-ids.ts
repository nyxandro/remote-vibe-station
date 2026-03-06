/**
 * @fileoverview Stable form field identifiers for ProvidersTab inputs.
 *
 * Exports:
 * - PROVIDERS_TAB_FIELD_IDS - Shared DOM ids/names for ProvidersTab form controls.
 */

export const PROVIDERS_TAB_FIELD_IDS = {
  providerSearch: "providers-tab-provider-search",
  cliproxyCallbackUrl: "providers-tab-cliproxy-callback-url",
  cliproxyCode: "providers-tab-cliproxy-code",
  cliproxyState: "providers-tab-cliproxy-state",
  proxyMode: "providers-tab-proxy-mode",
  vlessProxyUrl: "providers-tab-vless-proxy-url",
  noProxy: "providers-tab-no-proxy",
  apiKey: "providers-tab-api-key",
  oauthCode: "providers-tab-oauth-code"
} as const;
