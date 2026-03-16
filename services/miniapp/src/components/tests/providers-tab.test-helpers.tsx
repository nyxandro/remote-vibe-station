/**
 * @fileoverview Shared fixtures and render helper for ProvidersTab tests.
 *
 * Exports:
 * - cliproxyAccountsFixture - Baseline CLIProxy account payload with manageable account.
 * - proxySnapshotFixture - Baseline proxy runtime snapshot for ProvidersTab tests.
 * - renderProvidersTab - Renders ProvidersTab with overridable defaults.
 */

import { render } from "@testing-library/react";
import { ComponentProps } from "react";
import { vi } from "vitest";

import { ProvidersTab } from "../ProvidersTab";
import { CliproxyAccountState, ProxySettingsSnapshot } from "../../types";

type ProvidersTabProps = ComponentProps<typeof ProvidersTab>;

export const cliproxyAccountsFixture: CliproxyAccountState = {
  usageTrackingEnabled: true,
  providers: [
    { id: "codex", label: "Codex", connected: true },
    { id: "anthropic", label: "Claude", connected: false }
  ],
  accounts: [
    {
      id: "codex-user@example.com",
      provider: "codex",
      providerLabel: "Codex",
      name: "codex-user@example.com",
      email: "codex-user@example.com",
      account: "workspace-1",
      label: null,
      disabled: false,
      unavailable: false,
      canManage: true,
      status: "ready",
      statusMessage: "ok",
      quota: {
        mode: "live",
        planType: "plus",
        windows: [
          {
            id: "five-hour",
            label: "5 часов",
            remainingPercent: 65,
            resetAt: null,
            resetAfterSeconds: 3600
          },
          {
            id: "weekly",
            label: "7 дней",
            remainingPercent: 80,
            resetAt: null,
            resetAfterSeconds: 172800
          }
        ]
      },
      usage: {
        requestCount: 3,
        tokenCount: 1450,
        failedRequestCount: 1,
        models: ["gpt-5.4", "gpt-5.4-mini"],
        lastUsedAt: "2026-03-06T16:00:00.000Z"
      }
    }
  ]
};

export const proxySnapshotFixture: ProxySettingsSnapshot = {
  mode: "direct",
  vlessProxyUrl: null,
  noProxy: "localhost,127.0.0.1,backend,opencode,cliproxy",
  updatedAt: "2026-03-06T10:00:00.000Z",
  envPreview: {
    HTTP_PROXY: null,
    HTTPS_PROXY: null,
    ALL_PROXY: null,
    NO_PROXY: "localhost,127.0.0.1,backend,opencode,cliproxy"
  },
  runtimeFiles: {
    runtimeConfigDir: "/runtime",
    proxyEnvPath: "/runtime/proxy.env",
    overridePath: "/runtime/docker-compose.override.yml",
    recommendedApplyCommand: "docker compose up -d"
  }
};

export const buildProvidersTabProps = (
  overrides: Partial<ProvidersTabProps> = {}
): ProvidersTabProps => {
  /* Keep test setup concise while preserving realistic defaults for every required callback. */
  return {
    selected: {
      model: { providerID: "openai", modelID: "gpt-5" },
      thinking: "high",
      agent: "build"
    },
    providers: [],
    authMethods: {},
    isLoading: false,
    isSubmitting: false,
    oauthState: null,
    cliproxyAccounts: null,
    cliproxyOAuthStart: null,
    isCliproxyLoading: false,
    isCliproxySubmitting: false,
    proxySnapshot: null,
    isProxyLoading: false,
    isProxySaving: false,
    isProxyApplying: false,
    proxyApplyResult: null,
    onRefresh: vi.fn(),
    onStartConnect: vi.fn(),
    onSubmitApiKey: vi.fn(),
    onSubmitOAuthCode: vi.fn(),
    onCompleteOAuthAuto: vi.fn(),
    onDisconnect: vi.fn(),
    onChangeOAuthCodeDraft: vi.fn(),
    onReloadCliproxy: vi.fn(),
    onStartCliproxyAuth: vi.fn(),
    onCompleteCliproxyAuth: vi.fn(),
    onTestCliproxyAccount: vi.fn(),
    onActivateCliproxyAccount: vi.fn(),
    onDeleteCliproxyAccount: vi.fn(),
    onReloadProxy: vi.fn(),
    onSaveProxy: vi.fn(),
    onApplyProxy: vi.fn(),
    ...overrides
  };
};

export const renderProvidersTab = (overrides: Partial<ProvidersTabProps> = {}) => {
  /* Return props alongside render result so tests can assert exact callback calls without extra plumbing. */
  const props = buildProvidersTabProps(overrides);
  return {
    props,
    ...render(<ProvidersTab {...props} />)
  };
};
