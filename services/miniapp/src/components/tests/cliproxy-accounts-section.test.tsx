/**
 * @fileoverview UI tests for compact CLIProxy account accordion cards.
 *
 * Test suites:
 * - CliproxyAccountsSection - Verifies collapsed summaries, OAuth modal flows, quota selection, and account actions.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CliproxyAccountsSection } from "../CliproxyAccountsSection";
import { cliproxyAccountsFixture } from "./providers-tab.test-helpers";

type CliproxyAccountsSectionProps = ComponentProps<typeof CliproxyAccountsSection>;

const buildProps = (
  overrides: Partial<CliproxyAccountsSectionProps> = {}
): CliproxyAccountsSectionProps => {
  /* Keep every test focused on one UI behavior while preserving realistic callbacks and account data. */
  return {
    accounts: cliproxyAccountsFixture,
    oauthStart: null,
    isLoading: false,
    isSubmitting: false,
    onReload: vi.fn(),
    onStartAuth: vi.fn(),
    onCloseAuthModal: vi.fn(),
    onCompleteAuth: vi.fn(),
    onTestAccount: vi.fn(),
    onActivateAccount: vi.fn(),
    onDeleteAccount: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
};

const renderSection = (overrides: Partial<CliproxyAccountsSectionProps> = {}) => {
  /* Return props so assertions can verify the exact account-management callback input. */
  const props = buildProps(overrides);
  return {
    props,
    ...render(<CliproxyAccountsSection {...props} />)
  };
};

const getAccountToggle = (label = "Развернуть аккаунт Codex") => {
  /* Stable aria labels keep accordion tests resilient even when the visible summary layout changes. */
  return screen.getByRole("button", { name: label });
};

describe("CliproxyAccountsSection", () => {
  afterEach(() => {
    /* Reset DOM and mock call history so each accordion scenario stays isolated. */
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders collapsed account summary with only the short quota window by default", () => {
    /* Operators should see the provider, identity, status, and one primary limit without the verbose diagnostics wall. */
    renderSection();

    expect(screen.getByText("CLIProxy accounts")).toBeTruthy();
    expect(getAccountToggle()).toBeTruthy();
    expect(screen.getByText("codex-user@example.com")).toBeTruthy();
    expect(screen.getByText("ready")).toBeTruthy();
    expect(screen.getByText("Лимит: 5 часов")).toBeTruthy();
    expect(screen.getByText("65% осталось")).toBeTruthy();
    expect(getAccountToggle().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/7 дней/i)).toBeNull();
    expect(screen.queryByText("Запросы: 3")).toBeNull();
    expect(screen.queryByRole("button", { name: "Тест" })).toBeNull();
  });

  it("renders the CLIProxy OAuth step inside a modal dialog instead of inline page content", () => {
    /* Provider reconnect should open as an overlay so the providers page stays compact behind the auth flow. */
    renderSection({
      oauthStart: {
        provider: "codex",
        state: "state-123",
        url: "https://example.com/cliproxy",
        instructions: "Откройте URL в браузере, завершите вход и вставьте сюда URL callback или отдельно code/state"
      }
    });

    const dialog = screen.getByRole("dialog", { name: "Подключить Codex" });

    expect(within(dialog).getByText(/завершите вход/i)).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: "Открыть авторизацию" })).toBeTruthy();
    expect(within(dialog).getByLabelText("CLIProxy callback URL")).toBeTruthy();
    expect(within(dialog).getByLabelText("CLIProxy OAuth code")).toBeTruthy();
    expect((within(dialog).getByLabelText("CLIProxy OAuth state") as HTMLInputElement).value).toBe("state-123");
    expect(screen.queryByText(/^Provider:/i)).toBeNull();
  });

  it("closes the CLIProxy OAuth modal after successful completion clears the active auth step", () => {
    /* Successful completion should return the screen to its compact account list without leaving stale auth controls visible. */
    const rendered = renderSection({
      oauthStart: {
        provider: "codex",
        state: "state-123",
        url: "https://example.com/cliproxy",
        instructions: "Вставьте callback"
      }
    });

    fireEvent.change(screen.getByLabelText("CLIProxy callback URL"), {
      target: { value: "https://example.com/callback?code=abc" }
    });
    fireEvent.change(screen.getByLabelText("CLIProxy OAuth code"), {
      target: { value: "abc" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Завершить подключение" }));

    expect(rendered.props.onCompleteAuth).toHaveBeenCalledWith({
      provider: "codex",
      callbackUrl: "https://example.com/callback?code=abc",
      code: "abc",
      state: "state-123"
    });

    rendered.rerender(
      <CliproxyAccountsSection
        {...rendered.props}
        oauthStart={null}
      />
    );

    expect(screen.queryByRole("dialog", { name: "Подключить Codex" })).toBeNull();
  });

  it("lets the operator dismiss the CLIProxy OAuth modal without submitting", () => {
    /* Accidental reconnect opens should be dismissible so the user can get back to the account list instantly. */
    const { props } = renderSection({
      oauthStart: {
        provider: "codex",
        state: "state-123",
        url: "https://example.com/cliproxy",
        instructions: "Вставьте callback"
      }
    });

    fireEvent.click(screen.getByRole("button", { name: "Закрыть подключение CLIProxy" }));

    expect(props.onCloseAuthModal).toHaveBeenCalledTimes(1);
  });

  it("expands and collapses the account card on repeated clicks", () => {
    /* The card should behave like an accordion so dense actions stay hidden until the operator needs them. */
    renderSection();

    fireEvent.click(getAccountToggle());

    expect(screen.getByRole("button", { name: "Свернуть аккаунт Codex" }).getAttribute("aria-expanded")).toBe(
      "true"
    );
    expect(screen.getByText("Запросы: 3")).toBeTruthy();
    expect(screen.getByText("Токены: 1,450")).toBeTruthy();
    expect(screen.getByText("Ошибки: 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Тест" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Свернуть аккаунт Codex" }));

    expect(screen.getByRole("button", { name: "Развернуть аккаунт Codex" }).getAttribute("aria-expanded")).toBe(
      "false"
    );
    expect(screen.queryByText("Запросы: 3")).toBeNull();
    expect(screen.queryByRole("button", { name: "Тест" })).toBeNull();
  });

  it("parses CLIProxy usage-limit JSON into readable details after expansion", () => {
    /* Raw upstream JSON should become readable diagnostics only when the operator opens the specific account. */
    const statusMessage =
      '{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1773531611,"resets_in_seconds":438164}}';

    renderSection({
      accounts: {
        ...cliproxyAccountsFixture,
        accounts: [{ ...cliproxyAccountsFixture.accounts[0], statusMessage }]
      }
    });

    fireEvent.click(getAccountToggle());

    expect(screen.getByText("Ошибка: usage_limit_reached")).toBeTruthy();
    expect(screen.getAllByText("Тариф: plus").length).toBeGreaterThan(0);
    expect(screen.getByText(/Лимит сбросится:/i)).toBeTruthy();
    expect(screen.getByText(/Сброс через:/i)).toBeTruthy();
  });

  it("parses CLIProxy account deactivated JSON into readable details after expansion", () => {
    /* Deactivated-account errors should stay actionable without exposing raw JSON to the operator. */
    const statusMessage =
      '{"error":{"message":"Your OpenAI account has been deactivated, please check your email for more information.","type":"invalid_request_error","code":"account_deactivated","param":null},"status":401}';

    renderSection({
      accounts: {
        ...cliproxyAccountsFixture,
        accounts: [{ ...cliproxyAccountsFixture.accounts[0], statusMessage }]
      }
    });

    fireEvent.click(getAccountToggle());

    expect(screen.getByText("Ошибка: invalid_request_error")).toBeTruthy();
    expect(screen.getByText("Код: account_deactivated")).toBeTruthy();
    expect(screen.getByText("HTTP статус: 401")).toBeTruthy();
    expect(screen.getByText(/аккаунт деактивирован/i)).toBeTruthy();
  });

  it("shows the activate action for disabled accounts and forwards the selected id", () => {
    /* Disabled or unavailable accounts still need an explicit recovery action once their card is opened. */
    const { props } = renderSection({
      accounts: {
        ...cliproxyAccountsFixture,
        accounts: [
          {
            ...cliproxyAccountsFixture.accounts[0],
            disabled: true,
            unavailable: true,
            status: "error",
            quota: null
          }
        ]
      }
    });

    fireEvent.click(getAccountToggle());

    expect(screen.getByText("Недоступен для запросов прямо сейчас.")).toBeTruthy();
    expect(screen.getByText("Квота исчерпана")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Сделать активным" }));

    expect(props.onActivateAccount).toHaveBeenCalledWith("codex-user@example.com");
  });

  it("forwards the manual account test action only from the expanded card", () => {
    /* Manual health checks should stay tucked away until the operator intentionally expands the account. */
    const { props } = renderSection();

    fireEvent.click(getAccountToggle());
    fireEvent.click(screen.getByRole("button", { name: "Тест" }));

    expect(props.onTestAccount).toHaveBeenCalledWith("codex-user@example.com");
  });

  it("deletes an account only after explicit modal confirmation", () => {
    /* Destructive auth-file removal must stay behind a second confirmation even inside the expanded accordion. */
    const { props } = renderSection();

    fireEvent.click(getAccountToggle());
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));

    expect(props.onDeleteAccount).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog", { name: "Удалить CLIProxy аккаунт?" });
    expect(within(dialog).getByText("codex-user@example.com")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Удалить аккаунт" }));

    expect(props.onDeleteAccount).toHaveBeenCalledWith("codex-user@example.com");
  });

  it("allows cancelling account deletion from the confirmation modal", () => {
    /* Operators should be able to inspect the warning and back out without mutating CLIProxy auth state. */
    const { props } = renderSection();

    fireEvent.click(getAccountToggle());
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    fireEvent.click(screen.getByRole("button", { name: "Оставить аккаунт" }));

    expect(screen.queryByRole("dialog", { name: "Удалить CLIProxy аккаунт?" })).toBeNull();
    expect(props.onDeleteAccount).not.toHaveBeenCalled();
  });

  it("deduplicates repeated CLIProxy identity values inside the expanded details", () => {
    /* Repeated email/account/label values should still render once so the accordion body stays concise. */
    renderSection({
      accounts: {
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
            quota: null,
            usage: {
              requestCount: 1,
              tokenCount: 10,
              failedRequestCount: 0,
              models: ["gpt-5.4"],
              lastUsedAt: null
            }
          }
        ]
      }
    });

    fireEvent.click(getAccountToggle());

    expect(screen.getAllByText("za.nyxa@gmail.com")).toHaveLength(1);
  });

  it("shows the explicit usage-tracking disabled message above the account list", () => {
    /* Operators should understand why the compact cards do not show meaningful activity counters yet. */
    renderSection({
      accounts: {
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
            quota: null,
            usage: {
              requestCount: 0,
              tokenCount: 0,
              failedRequestCount: 0,
              models: [],
              lastUsedAt: null
            }
          }
        ]
      }
    });

    expect(screen.getByText(/наблюдаемая статистика usage выключена/i)).toBeTruthy();
  });
});
