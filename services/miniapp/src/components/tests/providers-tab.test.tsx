/**
 * @fileoverview UI tests for ProvidersTab provider picker flows and shared field wiring.
 *
 * Test suites:
 * - ProvidersTab - Verifies connected provider rendering, add-provider flows, CLIProxy section mounting, and stable field ids.
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

  it("hides the legacy selected-provider summary and opens add-provider panel", () => {
    /* Providers section should stay focused on actions and connected accounts without the extra summary block. */
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

    expect(screen.queryByText(/Текущий провайдер:/i)).toBeNull();
    expect(screen.queryByText(/Модель:/i)).toBeNull();
    expect(screen.queryByText(/Режим мышления:/i)).toBeNull();
    expect(screen.queryByText(/Агент:/i)).toBeNull();
    expect(screen.queryByText("Providers")).toBeNull();

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

  it("hides manual reload buttons now that providers sync reactively", () => {
    /* Providers screen should no longer require explicit reload controls for overview/runtime/account state. */
    renderProvidersTab({
      cliproxyAccounts: cliproxyAccountsFixture,
      proxySnapshot: proxySnapshotFixture
    });

    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reload accounts" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reload runtime" })).toBeNull();
  });

  it("filters provider search in add-provider panel", () => {
    /* Search should quickly narrow huge provider catalogs by prefix or substring. */
    renderProvidersTab({
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
    /* Manual key method should render inside the same compact modal shell as CLIProxy auth. */
    const { props } = renderProvidersTab({
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

    const dialog = screen.getByRole("dialog", { name: "API key для OpenAI" });

    fireEvent.change(screen.getByPlaceholderText("Введите API ключ"), {
      target: { value: "sk-live" }
    });
    fireEvent.click(dialog.querySelector(".btn.primary") as HTMLButtonElement);

    expect(props.onSubmitApiKey).toHaveBeenCalledWith({ providerID: "openai", key: "sk-live" });
  });

  it("closes OpenCode provider auth modal without submitting", () => {
    /* OpenCode auth modal should mirror CLIProxy modal dismissal behavior. */
    const { props } = renderProvidersTab({
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

    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(props.onCloseProviderAuthModal).toHaveBeenCalledTimes(1);
    expect(props.onSubmitApiKey).not.toHaveBeenCalled();
  });

  it("starts manual API key flow when OpenCode provider has no explicit auth methods", () => {
    /* OpenCode exposes many providers in /config/providers but /provider/auth only lists special OAuth flows for a few of them. */
    const { props } = renderProvidersTab({
      providers: [{ id: "deepseek", name: "DeepSeek", connected: false }],
      authMethods: {}
    });

    fireEvent.click(screen.getByRole("button", { name: "Добавить провайдера" }));
    fireEvent.click(screen.getByRole("button", { name: "DeepSeek" }));

    expect(props.onStartConnect).toHaveBeenCalledWith({ providerID: "deepseek", methodIndex: 0 });
  });

  it("mounts CLIProxy section under providers and forwards provider reconnect", () => {
    /* Providers tab should still embed the dedicated CLIProxy section without duplicating its internal tests here. */
    const { props } = renderProvidersTab({
      cliproxyAccounts: cliproxyAccountsFixture,
      proxySnapshot: proxySnapshotFixture
    });

    expect(screen.getByText("CLIProxy accounts")).toBeTruthy();
    expect(screen.getByText("codex-user@example.com")).toBeTruthy();
    expect(screen.getByText("Лимит: 24 часа")).toBeTruthy();
    expect(screen.queryByText("Лимит: 7 дней")).toBeNull();
    expect(screen.queryByRole("button", { name: "Тест" })).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Подключить / обновить" })[0]);

    expect(props.onStartCliproxyAuth).toHaveBeenCalledWith("codex");
  });

  it("assigns stable ids and names to Providers form fields", () => {
    /* Explicit ids and names remove a11y warnings and keep autofill deterministic. */
    renderProvidersTab({
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
        vlessProxyUrl: "http://vless-proxy:8080",
        vlessConfigUrl: "vless://uuid@example.com:443?type=tcp&security=reality#demo"
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
    expect(screen.getByLabelText("VLESS config URL").getAttribute("id")).toBe(
      PROVIDERS_TAB_FIELD_IDS.vlessConfigUrl
    );
    expect(screen.getByPlaceholderText("Введите OAuth code").getAttribute("id")).toBe(
      PROVIDERS_TAB_FIELD_IDS.oauthCode
    );
    expect(screen.getByRole("dialog", { name: "Подключить Anthropic" })).toBeTruthy();
  });

  it("requires a successful config test before saving vless settings", () => {
    /* Operators should not persist a raw VLESS URL before the runtime parser validates it. */
    const { props } = renderProvidersTab({
      proxySnapshot: {
        ...proxySnapshotFixture,
        mode: "vless",
        vlessProxyUrl: "http://vless-proxy:8080",
        vlessConfigUrl: "vless://uuid@example.com:443?type=tcp&security=reality#demo"
      }
    });

    fireEvent.change(screen.getByLabelText("VLESS config URL"), {
      target: { value: "vless://uuid@example.com:443?type=tcp&security=reality#demo" }
    });

    fireEvent.click(screen.getByRole("button", { name: "Test config" }));

    expect(props.onTestProxy).toHaveBeenCalledWith({
      vlessConfigUrl: "vless://uuid@example.com:443?type=tcp&security=reality#demo"
    });
    expect(screen.getByRole("button", { name: "Save proxy settings" }).hasAttribute("disabled")).toBe(true);
  });
});
