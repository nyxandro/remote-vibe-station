/**
 * @fileoverview UI tests for ProvidersTab connect/disconnect flows.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProvidersTab } from "../ProvidersTab";

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
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Введите API ключ"), {
      target: { value: "sk-live" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Подключить по API ключу" }));

    expect(onSubmitApiKey).toHaveBeenCalledWith({ providerID: "openai", key: "sk-live" });
  });
});
