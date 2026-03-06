/**
 * @fileoverview UI tests for ProvidersTab connect/disconnect flows.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProvidersTab } from "../ProvidersTab";
import { CliproxyAccountState, ProxySettingsSnapshot } from "../../types";

const cliproxyAccounts: CliproxyAccountState = {
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
      status: "ready",
      statusMessage: "ok",
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

const proxySnapshot: ProxySettingsSnapshot = {
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

describe("ProvidersTab", () => {
  afterEach(() => {
    /* Reset DOM between tests to keep role queries deterministic. */
    cleanup();
  });

  it("renders selected mode summary and opens add-provider panel", () => {
    /* Providers section should expose current provider/model/thinking/agent at top. */
    const onStartConnect = vi.fn();

    render(
      <ProvidersTab
        selected={{
          model: { providerID: "openai", modelID: "gpt-5" },
          thinking: "high",
          agent: "build"
        }}
        providers={[
          { id: "openai", name: "OpenAI", connected: true },
          { id: "anthropic", name: "Anthropic", connected: false }
        ]}
        authMethods={{
          openai: [{ type: "oauth", label: "ChatGPT" }],
          anthropic: [{ type: "oauth", label: "Claude Pro" }]
        }}
        isLoading={false}
        isSubmitting={false}
        oauthState={null}
        onRefresh={vi.fn()}
        onStartConnect={onStartConnect}
        onSubmitApiKey={vi.fn()}
        onSubmitOAuthCode={vi.fn()}
        onCompleteOAuthAuto={vi.fn()}
        onDisconnect={vi.fn()}
        cliproxyAccounts={null}
        cliproxyOAuthStart={null}
        isCliproxyLoading={false}
        isCliproxySubmitting={false}
        proxySnapshot={null}
        isProxyLoading={false}
        isProxySaving={false}
        isProxyApplying={false}
        proxyApplyResult={null}
        onReloadCliproxy={vi.fn()}
        onStartCliproxyAuth={vi.fn()}
        onCompleteCliproxyAuth={vi.fn()}
        onReloadProxy={vi.fn()}
        onSaveProxy={vi.fn()}
        onApplyProxy={vi.fn()}
      />
    );

    expect(screen.getByText("Текущий провайдер: openai")).toBeTruthy();
    expect(screen.getByText("Модель: gpt-5")).toBeTruthy();
    expect(screen.getByText("Режим мышления: high")).toBeTruthy();
    expect(screen.getByText("Агент: build")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Добавить провайдера" }));
    fireEvent.click(screen.getByRole("button", { name: "Anthropic" }));
    expect(onStartConnect).toHaveBeenCalledWith({ providerID: "anthropic", methodIndex: 0 });
  });

  it("shows only connected providers in the main list", () => {
    /* Main catalog should stay compact and display only active integrations. */
    render(
      <ProvidersTab
        selected={{
          model: { providerID: "openai", modelID: "gpt-5" },
          thinking: "high",
          agent: "build"
        }}
        providers={[
          { id: "openai", name: "OpenAI", connected: true },
          { id: "anthropic", name: "Anthropic", connected: false }
        ]}
        authMethods={{
          openai: [{ type: "oauth", label: "ChatGPT" }],
          anthropic: [{ type: "oauth", label: "Claude Pro" }]
        }}
        isLoading={false}
        isSubmitting={false}
        oauthState={null}
        onRefresh={vi.fn()}
        onStartConnect={vi.fn()}
        onSubmitApiKey={vi.fn()}
        onSubmitOAuthCode={vi.fn()}
        onCompleteOAuthAuto={vi.fn()}
        onDisconnect={vi.fn()}
        cliproxyAccounts={null}
        cliproxyOAuthStart={null}
        isCliproxyLoading={false}
        isCliproxySubmitting={false}
        proxySnapshot={null}
        isProxyLoading={false}
        isProxySaving={false}
        isProxyApplying={false}
        proxyApplyResult={null}
        onReloadCliproxy={vi.fn()}
        onStartCliproxyAuth={vi.fn()}
        onCompleteCliproxyAuth={vi.fn()}
        onReloadProxy={vi.fn()}
        onSaveProxy={vi.fn()}
        onApplyProxy={vi.fn()}
      />
    );

    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.queryByText("Anthropic")).toBeNull();
  });

  it("filters provider search in add-provider panel", () => {
    /* Search should quickly narrow huge provider catalogs by prefix or substring. */
    render(
      <ProvidersTab
        selected={{
          model: { providerID: "openai", modelID: "gpt-5" },
          thinking: null,
          agent: null
        }}
        providers={[
          { id: "openai", name: "OpenAI", connected: false },
          { id: "anthropic", name: "Anthropic", connected: false },
          { id: "groq", name: "Groq", connected: false }
        ]}
        authMethods={{
          openai: [{ type: "oauth", label: "ChatGPT" }],
          anthropic: [{ type: "oauth", label: "Claude Pro" }],
          groq: [{ type: "api", label: "API key" }]
        }}
        isLoading={false}
        isSubmitting={false}
        oauthState={null}
        onRefresh={vi.fn()}
        onStartConnect={vi.fn()}
        onSubmitApiKey={vi.fn()}
        onSubmitOAuthCode={vi.fn()}
        onCompleteOAuthAuto={vi.fn()}
        onDisconnect={vi.fn()}
        cliproxyAccounts={null}
        cliproxyOAuthStart={null}
        isCliproxyLoading={false}
        isCliproxySubmitting={false}
        proxySnapshot={null}
        isProxyLoading={false}
        isProxySaving={false}
        isProxyApplying={false}
        proxyApplyResult={null}
        onReloadCliproxy={vi.fn()}
        onStartCliproxyAuth={vi.fn()}
        onCompleteCliproxyAuth={vi.fn()}
        onReloadProxy={vi.fn()}
        onSaveProxy={vi.fn()}
        onApplyProxy={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Добавить провайдера" }));
    fireEvent.change(screen.getByPlaceholderText("Поиск провайдера"), {
      target: { value: "ant" }
    });

    expect(screen.getByRole("button", { name: "Anthropic" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "OpenAI" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Groq" })).toBeNull();
  });

  it("renders API key flow and submits credentials", () => {
    /* Manual key method should render secure input and submit button. */
    const onSubmitApiKey = vi.fn();

    render(
      <ProvidersTab
        selected={{
          model: { providerID: "openai", modelID: "gpt-5" },
          thinking: null,
          agent: null
        }}
        providers={[{ id: "openai", name: "OpenAI", connected: false }]}
        authMethods={{ openai: [{ type: "api", label: "API key" }] }}
        isLoading={false}
        isSubmitting={false}
        oauthState={{
          providerID: "openai",
          methodIndex: 0,
          method: "code",
          url: "",
          instructions: "api",
          codeDraft: ""
        }}
        onRefresh={vi.fn()}
        onStartConnect={vi.fn()}
        onSubmitApiKey={onSubmitApiKey}
        onSubmitOAuthCode={vi.fn()}
        onCompleteOAuthAuto={vi.fn()}
        onDisconnect={vi.fn()}
        cliproxyAccounts={null}
        cliproxyOAuthStart={null}
        isCliproxyLoading={false}
        isCliproxySubmitting={false}
        proxySnapshot={null}
        isProxyLoading={false}
        isProxySaving={false}
        isProxyApplying={false}
        proxyApplyResult={null}
        onReloadCliproxy={vi.fn()}
        onStartCliproxyAuth={vi.fn()}
        onCompleteCliproxyAuth={vi.fn()}
        onReloadProxy={vi.fn()}
        onSaveProxy={vi.fn()}
        onApplyProxy={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Введите API ключ"), {
      target: { value: "sk-live" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Подключить по API ключу" }));

    expect(onSubmitApiKey).toHaveBeenCalledWith({ providerID: "openai", key: "sk-live" });
  });

  it("renders CLIProxy account section under add-provider button and shows connected identities", () => {
    /* CLIProxy accounts should be managed from Providers tab and expose concrete identities plus observed usage. */
    const onStartCliproxyAuth = vi.fn();

    render(
      <ProvidersTab
        selected={{
          model: { providerID: "cliproxy", modelID: "gpt-5.4" },
          thinking: "high",
          agent: "build"
        }}
        providers={[]}
        authMethods={{}}
        isLoading={false}
        isSubmitting={false}
        oauthState={null}
        onRefresh={vi.fn()}
        onStartConnect={vi.fn()}
        onSubmitApiKey={vi.fn()}
        onSubmitOAuthCode={vi.fn()}
        onCompleteOAuthAuto={vi.fn()}
        onDisconnect={vi.fn()}
        cliproxyAccounts={cliproxyAccounts}
        cliproxyOAuthStart={null}
        isCliproxyLoading={false}
        isCliproxySubmitting={false}
        proxySnapshot={proxySnapshot}
        isProxyLoading={false}
        isProxySaving={false}
        isProxyApplying={false}
        proxyApplyResult={null}
        onReloadCliproxy={vi.fn()}
        onStartCliproxyAuth={onStartCliproxyAuth}
        onCompleteCliproxyAuth={vi.fn()}
        onReloadProxy={vi.fn()}
        onSaveProxy={vi.fn()}
        onApplyProxy={vi.fn()}
      />
    );

    const addProviderButton = screen.getByRole("button", { name: "Добавить провайдера" });
    expect(addProviderButton).toBeTruthy();
    expect(screen.getByText("CLIProxy accounts")).toBeTruthy();
    expect(screen.getByText("codex-user@example.com")).toBeTruthy();
    expect(screen.getByText("workspace-1")).toBeTruthy();
    expect(screen.getByText("Запросы: 3")).toBeTruthy();
    expect(screen.getByText("Токены: 1,450")).toBeTruthy();
    expect(screen.getByText("Ошибки: 1")).toBeTruthy();
    expect(screen.getByText(/Относительная активность:/)).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Подключить / обновить" })[0]);
    expect(onStartCliproxyAuth).toHaveBeenCalledWith("codex");
  });

  it("deduplicates repeated CLIProxy account details", () => {
    /* CLIProxy may mirror the same identity into email, account and label, but UI should show one line per unique value. */
    render(
      <ProvidersTab
        selected={{
          model: { providerID: "cliproxy", modelID: "gpt-5.4" },
          thinking: "high",
          agent: "build"
        }}
        providers={[]}
        authMethods={{}}
        isLoading={false}
        isSubmitting={false}
        oauthState={null}
        onRefresh={vi.fn()}
        onStartConnect={vi.fn()}
        onSubmitApiKey={vi.fn()}
        onSubmitOAuthCode={vi.fn()}
        onCompleteOAuthAuto={vi.fn()}
        onDisconnect={vi.fn()}
        cliproxyAccounts={{
          usageTrackingEnabled: true,
          providers: [{ id: "codex", label: "Codex", connected: true }],
          accounts: [
            {
              id: "za.nyxa@gmail.com",
              provider: "codex",
              providerLabel: "Codex",
              name: "za.nyxa@gmail.com",
              email: "za.nyxa@gmail.com",
              account: "za.nyxa@gmail.com",
              label: "za.nyxa@gmail.com",
              status: "active",
              statusMessage: "za.nyxa@gmail.com",
              usage: {
                requestCount: 1,
                tokenCount: 10,
                failedRequestCount: 0,
                models: ["gpt-5.4"],
                lastUsedAt: null
              }
            }
          ]
        }}
        cliproxyOAuthStart={null}
        isCliproxyLoading={false}
        isCliproxySubmitting={false}
        proxySnapshot={proxySnapshot}
        isProxyLoading={false}
        isProxySaving={false}
        isProxyApplying={false}
        proxyApplyResult={null}
        onReloadCliproxy={vi.fn()}
        onStartCliproxyAuth={vi.fn()}
        onCompleteCliproxyAuth={vi.fn()}
        onReloadProxy={vi.fn()}
        onSaveProxy={vi.fn()}
        onApplyProxy={vi.fn()}
      />
    );

    expect(screen.getAllByText("za.nyxa@gmail.com")).toHaveLength(1);
  });

  it("shows explicit message when CLIProxy usage tracking is disabled", () => {
    /* Operators should see why activity metrics are missing instead of reading all-zero stats as real usage. */
    render(
      <ProvidersTab
        selected={{
          model: { providerID: "cliproxy", modelID: "gpt-5.4" },
          thinking: "high",
          agent: "build"
        }}
        providers={[]}
        authMethods={{}}
        isLoading={false}
        isSubmitting={false}
        oauthState={null}
        onRefresh={vi.fn()}
        onStartConnect={vi.fn()}
        onSubmitApiKey={vi.fn()}
        onSubmitOAuthCode={vi.fn()}
        onCompleteOAuthAuto={vi.fn()}
        onDisconnect={vi.fn()}
        cliproxyAccounts={{
          usageTrackingEnabled: false,
          providers: [{ id: "codex", label: "Codex", connected: true }],
          accounts: [
            {
              id: "codex-user@example.com",
              provider: "codex",
              providerLabel: "Codex",
              name: "codex-user@example.com",
              email: "codex-user@example.com",
              account: null,
              label: null,
              status: "ready",
              statusMessage: null,
              usage: {
                requestCount: 0,
                tokenCount: 0,
                failedRequestCount: 0,
                models: [],
                lastUsedAt: null
              }
            }
          ]
        }}
        cliproxyOAuthStart={null}
        isCliproxyLoading={false}
        isCliproxySubmitting={false}
        proxySnapshot={proxySnapshot}
        isProxyLoading={false}
        isProxySaving={false}
        isProxyApplying={false}
        proxyApplyResult={null}
        onReloadCliproxy={vi.fn()}
        onStartCliproxyAuth={vi.fn()}
        onCompleteCliproxyAuth={vi.fn()}
        onReloadProxy={vi.fn()}
        onSaveProxy={vi.fn()}
        onApplyProxy={vi.fn()}
      />
    );

    expect(screen.getByText(/наблюдаемая статистика usage выключена/i)).toBeTruthy();
  });
});
