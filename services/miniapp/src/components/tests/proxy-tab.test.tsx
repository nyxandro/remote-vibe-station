/**
 * @fileoverview UI tests for ProxyTab account onboarding and runtime controls.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProxyTab } from "../ProxyTab";
import { CliproxyAccountState, CliproxyOAuthStartPayload, ProxySettingsSnapshot } from "../../types";

const baseSnapshot: ProxySettingsSnapshot = {
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

const baseAccounts: CliproxyAccountState = {
  providers: [
    { id: "codex", label: "Codex", connected: false },
    { id: "anthropic", label: "Claude", connected: true }
  ],
  authFiles: []
};

const renderProxyTab = (overrides?: {
  snapshot?: ProxySettingsSnapshot | null;
  cliproxyAccounts?: CliproxyAccountState | null;
  cliproxyOAuthStart?: CliproxyOAuthStartPayload | null;
  isCliproxyLoading?: boolean;
  isCliproxySubmitting?: boolean;
  isSaving?: boolean;
}) => {
  const handlers = {
    onReload: vi.fn(),
    onSave: vi.fn(),
    onApply: vi.fn(),
    onReloadCliproxy: vi.fn(),
    onStartCliproxyAuth: vi.fn(),
    onCompleteCliproxyAuth: vi.fn()
  };

  /* Centralized renderer keeps tests focused on behavior, not prop boilerplate. */
  render(
    <ProxyTab
      snapshot={overrides?.snapshot ?? baseSnapshot}
      isLoading={false}
      isSaving={overrides?.isSaving ?? false}
      isApplying={false}
      applyResult={null}
      cliproxyAccounts={overrides?.cliproxyAccounts ?? baseAccounts}
      cliproxyOAuthStart={overrides?.cliproxyOAuthStart ?? null}
      isCliproxyLoading={overrides?.isCliproxyLoading ?? false}
      isCliproxySubmitting={overrides?.isCliproxySubmitting ?? false}
      onReload={handlers.onReload}
      onSave={handlers.onSave}
      onApply={handlers.onApply}
      onReloadCliproxy={handlers.onReloadCliproxy}
      onStartCliproxyAuth={handlers.onStartCliproxyAuth}
      onCompleteCliproxyAuth={handlers.onCompleteCliproxyAuth}
    />
  );

  return handlers;
};

describe("ProxyTab", () => {
  afterEach(() => {
    /* Clean DOM and mock calls so role and text queries stay deterministic. */
    cleanup();
  });

  it("starts CLIProxy auth flow for selected provider", () => {
    /* Provider cards must trigger account auth inside CLIProxy, not Providers tab handlers. */
    const handlers = renderProxyTab();

    fireEvent.click(screen.getAllByRole("button", { name: "Подключить / обновить" })[0]);

    expect(handlers.onStartCliproxyAuth).toHaveBeenCalledWith("codex");
  });

  it("submits OAuth completion from callback URL and prefilled state", () => {
    /* Completion action should send provider+callback URL+state so backend can parse code safely. */
    const handlers = renderProxyTab({
      cliproxyOAuthStart: {
        provider: "codex",
        state: "state-123",
        url: "https://auth.example.com",
        instructions: "Finish auth and paste callback URL"
      }
    });

    fireEvent.change(screen.getByPlaceholderText("Вставьте callback URL целиком"), {
      target: { value: "https://callback.example.com/?code=abc&state=state-123" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Завершить подключение" }));

    expect(handlers.onCompleteCliproxyAuth).toHaveBeenCalledWith({
      provider: "codex",
      callbackUrl: "https://callback.example.com/?code=abc&state=state-123",
      code: undefined,
      state: "state-123"
    });
  });

  it("saves vless runtime profile with trimmed values", () => {
    /* Runtime profile save must keep explicit mode and sanitized values for backend validation. */
    const handlers = renderProxyTab();

    fireEvent.change(screen.getByLabelText("Outbound mode"), { target: { value: "vless" } });
    fireEvent.change(screen.getByLabelText("VLESS proxy URL"), {
      target: { value: "  http://vless-proxy:8080  " }
    });
    fireEvent.change(screen.getByLabelText("NO_PROXY"), {
      target: { value: "  localhost,cliproxy  " }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save proxy settings" }));

    expect(handlers.onSave).toHaveBeenCalledWith({
      mode: "vless",
      vlessProxyUrl: "http://vless-proxy:8080",
      noProxy: "localhost,cliproxy"
    });
  });

  it("resets callback/code drafts when oauth provider changes", () => {
    /* Switching OAuth flow must clear stale callback/code from previous provider attempt. */
    const onCompleteCliproxyAuth = vi.fn();

    const { rerender } = render(
      <ProxyTab
        snapshot={baseSnapshot}
        isLoading={false}
        isSaving={false}
        isApplying={false}
        applyResult={null}
        cliproxyAccounts={baseAccounts}
        cliproxyOAuthStart={{
          provider: "codex",
          state: "state-codex",
          url: "https://auth.codex.example.com",
          instructions: "Open auth URL"
        }}
        isCliproxyLoading={false}
        isCliproxySubmitting={false}
        onReload={vi.fn()}
        onSave={vi.fn()}
        onApply={vi.fn()}
        onReloadCliproxy={vi.fn()}
        onStartCliproxyAuth={vi.fn()}
        onCompleteCliproxyAuth={onCompleteCliproxyAuth}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Вставьте callback URL целиком"), {
      target: { value: "https://callback.example.com/?code=old&state=state-codex" }
    });
    fireEvent.change(screen.getByPlaceholderText("Или отдельно code"), {
      target: { value: "old-code" }
    });

    rerender(
      <ProxyTab
        snapshot={baseSnapshot}
        isLoading={false}
        isSaving={false}
        isApplying={false}
        applyResult={null}
        cliproxyAccounts={baseAccounts}
        cliproxyOAuthStart={{
          provider: "anthropic",
          state: "state-claude",
          url: "https://auth.claude.example.com",
          instructions: "Open auth URL"
        }}
        isCliproxyLoading={false}
        isCliproxySubmitting={false}
        onReload={vi.fn()}
        onSave={vi.fn()}
        onApply={vi.fn()}
        onReloadCliproxy={vi.fn()}
        onStartCliproxyAuth={vi.fn()}
        onCompleteCliproxyAuth={onCompleteCliproxyAuth}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Завершить подключение" }));
    expect(onCompleteCliproxyAuth).toHaveBeenCalledWith({
      provider: "anthropic",
      callbackUrl: undefined,
      code: undefined,
      state: "state-claude"
    });
  });
});
