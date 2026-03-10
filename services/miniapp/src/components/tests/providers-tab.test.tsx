/**
 * @fileoverview UI tests for ProvidersTab direct auth and CLIProxy account management flows.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PROVIDERS_TAB_FIELD_IDS } from "../providers-tab-field-ids";
import {
  cliproxyAccountsFixture,
  proxySnapshotFixture,
  renderProvidersTab
} from "./providers-tab.test-helpers";

describe("ProvidersTab", () => {
  afterEach(() => {
    /* Reset DOM and mocks between scenarios so role queries and confirm state stay deterministic. */
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders selected mode summary and opens add-provider panel", () => {
    /* Providers section should expose current provider/model/thinking/agent at top. */
    const { props } = renderProvidersTab({
      providers: [
        { id: "openai", name: "OpenAI", connected: true },
        { id: "anthropic", name: "Anthropic", connected: false }
      ],
      authMethods: {
        openai: [{ type: "oauth", label: "ChatGPT" }],
        anthropic: [{ type: "oauth", label: "Claude Pro" }]
      }
    });

    expect(screen.getByText("Текущий провайдер: openai")).toBeTruthy();
    expect(screen.getByText("Модель: gpt-5")).toBeTruthy();
    expect(screen.getByText("Режим мышления: high")).toBeTruthy();
    expect(screen.getByText("Агент: build")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Добавить провайдера" }));
    fireEvent.click(screen.getByRole("button", { name: "Anthropic" }));

    expect(props.onStartConnect).toHaveBeenCalledWith({ providerID: "anthropic", methodIndex: 0 });
  });

  it("shows only connected providers in the main list", () => {
    /* Main catalog should stay compact and display only active integrations. */
    renderProvidersTab({
      providers: [
        { id: "openai", name: "OpenAI", connected: true },
        { id: "anthropic", name: "Anthropic", connected: false }
      ],
      authMethods: {
        openai: [{ type: "oauth", label: "ChatGPT" }],
        anthropic: [{ type: "oauth", label: "Claude Pro" }]
      }
    });

    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.queryByText("Anthropic")).toBeNull();
  });

  it("filters provider search in add-provider panel", () => {
    /* Search should quickly narrow huge provider catalogs by prefix or substring. */
    renderProvidersTab({
      selected: {
        model: { providerID: "openai", modelID: "gpt-5" },
        thinking: null,
        agent: null
      },
      providers: [
        { id: "openai", name: "OpenAI", connected: false },
        { id: "anthropic", name: "Anthropic", connected: false },
        { id: "groq", name: "Groq", connected: false }
      ],
      authMethods: {
        openai: [{ type: "oauth", label: "ChatGPT" }],
        anthropic: [{ type: "oauth", label: "Claude Pro" }],
        groq: [{ type: "api", label: "API key" }]
      }
    });

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
    const { props } = renderProvidersTab({
      selected: {
        model: { providerID: "openai", modelID: "gpt-5" },
        thinking: null,
        agent: null
      },
      providers: [{ id: "openai", name: "OpenAI", connected: false }],
      authMethods: { openai: [{ type: "api", label: "API key" }] },
      oauthState: {
        providerID: "openai",
        methodIndex: 0,
        method: "code",
        url: "",
        instructions: "api",
        codeDraft: ""
      }
    });

    fireEvent.change(screen.getByPlaceholderText("Введите API ключ"), {
      target: { value: "sk-live" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Подключить по API ключу" }));

    expect(props.onSubmitApiKey).toHaveBeenCalledWith({ providerID: "openai", key: "sk-live" });
  });

  it("renders CLIProxy accounts under providers and shows connected identities", () => {
    /* CLIProxy accounts should be managed from Providers tab with usage and reconnect controls. */
    const { props } = renderProvidersTab({
      selected: {
        model: { providerID: "cliproxy", modelID: "gpt-5.4" },
        thinking: "high",
        agent: "build"
      },
      cliproxyAccounts: cliproxyAccountsFixture,
      proxySnapshot: proxySnapshotFixture
    });

    expect(screen.getByText("CLIProxy accounts")).toBeTruthy();
    expect(screen.getByText("codex-user@example.com")).toBeTruthy();
    expect(screen.getByText("workspace-1")).toBeTruthy();
    expect(screen.getByText("Запросы: 3")).toBeTruthy();
    expect(screen.getByText("Токены: 1,450")).toBeTruthy();
    expect(screen.getByText("Ошибки: 1")).toBeTruthy();
    expect(screen.getByText("Limit: 0%")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: /Limit for codex-user@example.com/i })).toBeTruthy();
    expect(screen.getByText("Limit 0%")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Подключить / обновить" })[0]);

    expect(props.onStartCliproxyAuth).toHaveBeenCalledWith("codex");
  });

  it("marks long CLIProxy detail lines as wrapping-safe content", () => {
    /* Long provider diagnostics must stay inside the card instead of stretching the layout horizontally. */
    const longDetail =
      '{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"free","resets_at":1773387976}}';

    renderProvidersTab({
      selected: {
        model: { providerID: "cliproxy", modelID: "gpt-5.4" },
        thinking: "high",
        agent: "build"
      },
      cliproxyAccounts: {
        ...cliproxyAccountsFixture,
        accounts: [
          {
            ...cliproxyAccountsFixture.accounts[0],
            statusMessage: longDetail
          }
        ]
      },
      proxySnapshot: proxySnapshotFixture
    });

    const detail = screen.getByText(longDetail);
    expect(detail.className).toContain("providers-account-detail");
  });

  it("shows activate action for disabled CLIProxy account and forwards selection", () => {
    /* Disabled or unavailable accounts must expose explicit recovery path in Mini App. */
    const { props } = renderProvidersTab({
      selected: {
        model: { providerID: "cliproxy", modelID: "gpt-5.4" },
        thinking: "high",
        agent: "build"
      },
      cliproxyAccounts: {
        ...cliproxyAccountsFixture,
        accounts: [
          {
            ...cliproxyAccountsFixture.accounts[0],
            disabled: true,
            unavailable: true,
            status: "error"
          }
        ]
      },
      proxySnapshot: proxySnapshotFixture
    });

    expect(screen.getByText("Недоступен для запросов прямо сейчас.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Сделать активным" }));

    expect(props.onActivateCliproxyAccount).toHaveBeenCalledWith("codex-user@example.com");
  });

  it("forwards manual CLIProxy account test action", () => {
    /* Operators should be able to force a live check when status looks stale or delayed. */
    const { props } = renderProvidersTab({
      selected: {
        model: { providerID: "cliproxy", modelID: "gpt-5.4" },
        thinking: "high",
        agent: "build"
      },
      cliproxyAccounts: cliproxyAccountsFixture,
      proxySnapshot: proxySnapshotFixture
    });

    fireEvent.click(screen.getByRole("button", { name: "Тест" }));

    expect(props.onTestCliproxyAccount).toHaveBeenCalledWith("codex-user@example.com");
  });

  it("deletes CLIProxy account only after confirmation", () => {
    /* Destructive account removal must stay behind explicit browser confirmation. */
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { props } = renderProvidersTab({
      selected: {
        model: { providerID: "cliproxy", modelID: "gpt-5.4" },
        thinking: "high",
        agent: "build"
      },
      cliproxyAccounts: cliproxyAccountsFixture,
      proxySnapshot: proxySnapshotFixture
    });

    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));

    expect(confirmSpy).toHaveBeenCalledWith("Удалить аккаунт codex-user@example.com?");
    expect(props.onDeleteCliproxyAccount).toHaveBeenCalledWith("codex-user@example.com");
  });

  it("deduplicates repeated CLIProxy account details", () => {
    /* CLIProxy may mirror the same identity into email, account and label, but UI should show one line per value. */
    renderProvidersTab({
      selected: {
        model: { providerID: "cliproxy", modelID: "gpt-5.4" },
        thinking: "high",
        agent: "build"
      },
      cliproxyAccounts: {
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
            disabled: false,
            unavailable: false,
            canManage: true,
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
      },
      proxySnapshot: proxySnapshotFixture
    });

    expect(screen.getAllByText("za.nyxa@gmail.com")).toHaveLength(1);
  });

  it("shows explicit message when CLIProxy usage tracking is disabled", () => {
    /* Operators should see why metrics are empty instead of reading zeros as real usage. */
    renderProvidersTab({
      selected: {
        model: { providerID: "cliproxy", modelID: "gpt-5.4" },
        thinking: "high",
        agent: "build"
      },
      cliproxyAccounts: {
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
            disabled: false,
            unavailable: false,
            canManage: true,
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
      },
      proxySnapshot: proxySnapshotFixture
    });

    expect(screen.getByText(/наблюдаемая статистика usage выключена/i)).toBeTruthy();
  });

  it("assigns stable ids and names to Providers form fields", () => {
    /* Explicit ids and names remove a11y warnings and keep autofill deterministic. */
    renderProvidersTab({
      selected: {
        model: { providerID: "cliproxy", modelID: "gpt-5.4" },
        thinking: "high",
        agent: "build"
      },
      providers: [{ id: "anthropic", name: "Anthropic", connected: false }],
      authMethods: { anthropic: [{ type: "oauth", label: "Claude Pro" }] },
      oauthState: {
        providerID: "anthropic",
        methodIndex: 0,
        method: "code",
        url: "https://example.com/oauth",
        instructions: "Введите OAuth code",
        codeDraft: ""
      },
      cliproxyAccounts: cliproxyAccountsFixture,
      cliproxyOAuthStart: {
        provider: "codex",
        state: "state-123",
        url: "https://example.com/cliproxy",
        instructions: "Вставьте callback"
      },
      proxySnapshot: {
        ...proxySnapshotFixture,
        mode: "vless",
        vlessProxyUrl: "http://vless-proxy:8080"
      }
    });

    fireEvent.click(screen.getByRole("button", { name: "Добавить провайдера" }));

    expect(screen.getByPlaceholderText("Поиск провайдера").getAttribute("id")).toBe(
      PROVIDERS_TAB_FIELD_IDS.providerSearch
    );
    expect(screen.getByPlaceholderText("Поиск провайдера").getAttribute("name")).toBe(
      PROVIDERS_TAB_FIELD_IDS.providerSearch
    );
    expect(screen.getByPlaceholderText("Вставьте callback URL целиком").getAttribute("id")).toBe(
      PROVIDERS_TAB_FIELD_IDS.cliproxyCallbackUrl
    );
    expect(screen.getByPlaceholderText("Или отдельно code").getAttribute("name")).toBe(
      PROVIDERS_TAB_FIELD_IDS.cliproxyCode
    );
    expect(screen.getByPlaceholderText("state").getAttribute("id")).toBe(
      PROVIDERS_TAB_FIELD_IDS.cliproxyState
    );
    expect(screen.getByLabelText("Outbound mode").getAttribute("name")).toBe(
      PROVIDERS_TAB_FIELD_IDS.proxyMode
    );
    expect(screen.getByLabelText("VLESS proxy URL").getAttribute("id")).toBe(
      PROVIDERS_TAB_FIELD_IDS.vlessProxyUrl
    );
    expect(screen.getByLabelText("NO_PROXY").getAttribute("name")).toBe(
      PROVIDERS_TAB_FIELD_IDS.noProxy
    );
    expect(screen.getByPlaceholderText("Введите OAuth code").getAttribute("id")).toBe(
      PROVIDERS_TAB_FIELD_IDS.oauthCode
    );
  });
});
