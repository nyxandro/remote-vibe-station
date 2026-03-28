/**
 * @fileoverview CLIProxy account management section for Providers tab.
 *
 * Exports:
 * - CliproxyAccountsSection (L36) - Renders account cards, manual switch/delete actions, and OAuth completion form.
 */

import { useEffect, useState } from "react";

import { CliproxyAccountState, CliproxyOAuthStartPayload } from "../types";
import { CliproxyQuotaBlock } from "./CliproxyQuotaBlock";
import { DangerConfirmModal } from "./DangerConfirmModal";
import { PROVIDERS_TAB_FIELD_IDS } from "./providers-tab-field-ids";

type Props = {
  accounts: CliproxyAccountState | null;
  oauthStart: CliproxyOAuthStartPayload | null;
  isLoading: boolean;
  isSubmitting: boolean;
  onReload?: () => void;
  onStartAuth: (provider: CliproxyAccountState["providers"][number]["id"]) => void;
  onCompleteAuth: (input: {
    provider: CliproxyAccountState["providers"][number]["id"];
    callbackUrl?: string;
    code?: string;
    state?: string;
    error?: string;
  }) => void;
  onTestAccount: (accountId: string) => void;
  onActivateAccount: (accountId: string) => void;
  onDeleteAccount: (accountId: string) => Promise<void> | void;
};

type ParsedCliproxyStatusMessage = {
  details: string[];
  isQuotaExceeded: boolean;
};

export const CliproxyAccountsSection = (props: Props) => {
  const [callbackUrlDraft, setCallbackUrlDraft] = useState<string>("");
  const [codeDraft, setCodeDraft] = useState<string>("");
  const [stateDraft, setStateDraft] = useState<string>("");
  const [pendingDeleteAccountId, setPendingDeleteAccountId] = useState<string | null>(null);

  useEffect(() => {
    /* Starting a new auth flow must reset callback drafts from previous attempts. */
    setCallbackUrlDraft("");
    setCodeDraft("");
    setStateDraft(props.oauthStart?.state ?? "");
  }, [props.oauthStart]);

  const selectedProvider = props.oauthStart?.provider;
  const pendingDeleteAccount = props.accounts?.accounts.find((account) => account.id === pendingDeleteAccountId) ?? null;

  const formatDuration = (seconds: number): string => {
    /* Relative reset countdown must stay readable instead of exposing raw provider seconds. */
    const normalizedSeconds = Math.max(0, Math.trunc(seconds));
    const days = Math.floor(normalizedSeconds / 86_400);
    const hours = Math.floor((normalizedSeconds % 86_400) / 3_600);
    const minutes = Math.floor((normalizedSeconds % 3_600) / 60);
    const parts: string[] = [];

    if (days > 0) {
      parts.push(`${days}д`);
    }
    if (hours > 0) {
      parts.push(`${hours}ч`);
    }
    if (minutes > 0 || parts.length === 0) {
      parts.push(`${minutes}м`);
    }

    return parts.join(" ");
  };

  const normalizeCliproxyStatusMessage = (
    value: string | null
  ): ParsedCliproxyStatusMessage => {
    /* Structured upstream JSON errors should become short operator-friendly lines in the account card. */
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      return { details: [], isQuotaExceeded: false };
    }

    try {
      const parsed = JSON.parse(normalized) as {
        error?: {
          type?: unknown;
          message?: unknown;
          plan_type?: unknown;
          resets_at?: unknown;
          resets_in_seconds?: unknown;
          code?: unknown;
        };
        status?: unknown;
      };
      const error = parsed?.error;
      if (!error || typeof error !== "object") {
        return { details: [normalized], isQuotaExceeded: false };
      }

      const details: string[] = [];
      const errorType = typeof error.type === "string" ? error.type.trim() : "";
      const message = typeof error.message === "string" ? error.message.trim() : "";
      const planType = typeof error.plan_type === "string" ? error.plan_type.trim() : "";
      const errorCode = typeof error.code === "string" ? error.code.trim() : "";
      const statusCode =
        typeof parsed.status === "number" && Number.isFinite(parsed.status) ? Math.trunc(parsed.status) : null;
      const resetsAtValue = typeof error.resets_at === "number" ? error.resets_at : Number.NaN;
      const resetsAt = Number.isFinite(resetsAtValue) ? new Date(resetsAtValue * 1000) : null;
      const resetsInSecondsValue =
        typeof error.resets_in_seconds === "number" ? error.resets_in_seconds : Number.NaN;
      const isQuotaExceeded = errorType === "usage_limit_reached";

      if (errorType) {
        details.push(`Ошибка: ${errorType}`);
      }

      if (message) {
        const translatedMessage =
          errorCode === "account_deactivated"
            ? "OpenAI сообщает, что аккаунт деактивирован. Проверь почту этого аккаунта."
            : message;
        details.push(translatedMessage);
      }

      if (planType) {
        details.push(`Тариф: ${planType}`);
      }

      if (errorCode) {
        details.push(`Код: ${errorCode}`);
      }

      if (statusCode !== null) {
        details.push(`HTTP статус: ${statusCode}`);
      }

      if (resetsAt && !Number.isNaN(resetsAt.getTime())) {
        details.push(`Лимит сбросится: ${resetsAt.toLocaleString()}`);
      }

      if (Number.isFinite(resetsInSecondsValue)) {
        details.push(`Сброс через: ${formatDuration(resetsInSecondsValue)}`);
      }

      return {
        details: details.length > 0 ? details : [normalized],
        isQuotaExceeded
      };
    } catch {
      /* Plain-text provider details should remain visible even when they are not JSON payloads. */
      return { details: [normalized], isQuotaExceeded: false };
    }
  };

  const getCliproxyAccountDetails = (account: CliproxyAccountState["accounts"][number]): string[] => {
    /* CLIProxy may duplicate identity data across fields, so collapse repeated values for one concise card. */
    const uniqueDetails = new Set<string>();

    [account.email ?? account.name, account.account, account.label].forEach((value) => {
      const normalized = String(value ?? "").trim();
      if (normalized) {
        uniqueDetails.add(normalized);
      }
    });

    normalizeCliproxyStatusMessage(account.statusMessage).details.forEach((detail) => {
      const normalized = detail.trim();
      if (normalized) {
        uniqueDetails.add(normalized);
      }
    });

    return Array.from(uniqueDetails);
  };

  const formatUsageNumber = (value: number): string => {
    /* Locale-aware formatting keeps compact usage counters readable on mobile. */
    return new Intl.NumberFormat("en-US").format(Math.max(0, Math.trunc(value)));
  };

  const formatUsageDate = (value: string | null): string => {
    /* Empty timestamps should read as no activity yet instead of Invalid Date. */
    if (!value) {
      return "еще нет";
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "еще нет" : parsed.toLocaleString();
  };

  const getQuotaState = (account: CliproxyAccountState["accounts"][number]): {
    label: string;
    value: number;
  } => {
    /* Availability fallback remains useful for providers that do not expose live quota windows. */
    const parsedStatus = normalizeCliproxyStatusMessage(account.statusMessage);
    if (parsedStatus.isQuotaExceeded || account.unavailable) {
      return {
        label: "Квота исчерпана",
        value: 0
      };
    }

    return {
      label: "Квота доступна",
      value: 100
    };
  };

  return (
    <div className="providers-auth-card">
      {/* CLIProxy onboarding and account steering stay together so operators manage one pool in one place. */}
      <div className="settings-header-row">
        <strong>CLIProxy accounts</strong>
      </div>

      <div className="project-create-note">
        Здесь отображаются аккаунты, уже подключенные внутри CLIProxy. Можно вручную сделать один аккаунт активным или удалить ненужный auth file.
      </div>
      <div className="project-create-note">
        Если CLIProxy runtime поддерживает live quota endpoints, карточки ниже показывают реальные окна лимитов. Для остальных провайдеров остается статус доступности.
      </div>

      {!props.accounts?.usageTrackingEnabled ? (
        <div className="project-create-note">
          CLIProxy: наблюдаемая статистика usage выключена, поэтому активность по аккаунтам пока не собирается.
        </div>
      ) : null}

      <div className="providers-list">
        {props.accounts?.accounts.map((account) => {
          const quotaState = getQuotaState(account);
          return (
            <div key={`cliproxy-account:${account.id}`} className="providers-item-card">
              {/* Status badge must distinguish active, disabled and unavailable accounts at a glance. */}
              <div className="providers-item-head">
                <span className="providers-item-name">{account.providerLabel}</span>
                <span className={`providers-badge ${account.disabled ? "disconnected" : "connected"}`}>
                  {account.disabled ? "disabled" : account.status ?? "connected"}
                </span>
              </div>

              {getCliproxyAccountDetails(account).map((detail) => (
                <div key={`${account.id}:${detail}`} className="project-create-note providers-account-detail">
                  {detail}
                </div>
              ))}

              {account.unavailable ? (
                <div className="project-create-note">Недоступен для запросов прямо сейчас.</div>
              ) : null}
              <div className="project-create-note">Запросы: {formatUsageNumber(account.usage.requestCount)}</div>
              <div className="project-create-note">Токены: {formatUsageNumber(account.usage.tokenCount)}</div>
              <div className="project-create-note">Ошибки: {formatUsageNumber(account.usage.failedRequestCount)}</div>
              <div className="project-create-note">Последняя активность: {formatUsageDate(account.usage.lastUsedAt)}</div>
              {account.usage.models.length > 0 ? (
                <div className="project-create-note">Модели: {account.usage.models.join(", ")}</div>
              ) : null}
              {props.accounts ? (
                <CliproxyQuotaBlock
                  account={account}
                  fallbackLabel={quotaState.label}
                  fallbackValue={quotaState.value}
                  formatDuration={formatDuration}
                />
              ) : null}

              {/* Account actions stay explicit because activation disables same-provider siblings on the backend. */}
              {account.canManage ? (
                <div className="providers-action-row">
                  <button
                    className="btn outline"
                    type="button"
                    disabled={props.isSubmitting}
                    onClick={() => props.onTestAccount(account.id)}
                  >
                    Тест
                  </button>
                  <button
                    className="btn outline"
                    type="button"
                    disabled={props.isSubmitting || (!account.disabled && !account.unavailable)}
                    onClick={() => props.onActivateAccount(account.id)}
                  >
                    {account.disabled || account.unavailable ? "Сделать активным" : "Активен"}
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    disabled={props.isSubmitting}
                    onClick={() => setPendingDeleteAccountId(account.id)}
                  >
                    Удалить
                  </button>
                </div>
              ) : (
                <div className="project-create-note">Этот аккаунт нельзя изменять из Mini App.</div>
              )}
            </div>
          );
        })}

        {!props.accounts || props.accounts.accounts.length === 0 ? (
          <div className="providers-empty">Пока нет подключенных CLIProxy аккаунтов.</div>
        ) : null}
      </div>

      <div className="providers-list">
        {(props.accounts?.providers ?? []).map((provider) => (
          <div key={`cliproxy-provider:${provider.id}`} className="providers-item-card">
            {/* Provider cards are kept separate from account cards because login flow is provider-scoped. */}
            <div className="providers-item-head">
              <span className="providers-item-name">{provider.label}</span>
              <span className={`providers-badge ${provider.connected ? "connected" : "disconnected"}`}>
                {provider.connected ? "Connected" : "Disconnected"}
              </span>
            </div>
            <button
              className="btn outline"
              type="button"
              disabled={props.isSubmitting}
              onClick={() => props.onStartAuth(provider.id)}
            >
              Подключить / обновить
            </button>
          </div>
        ))}
      </div>

      {props.oauthStart ? (
        <>
          {/* Completion accepts pasted callback URL or raw code/state for provider-specific OAuth flows. */}
          <div className="project-create-note">Provider: {props.oauthStart.provider}</div>
          <div className="project-create-note">{props.oauthStart.instructions}</div>
          <a className="btn outline" href={props.oauthStart.url} target="_blank" rel="noreferrer">
            Открыть авторизацию
          </a>

          <input
            id={PROVIDERS_TAB_FIELD_IDS.cliproxyCallbackUrl}
            name={PROVIDERS_TAB_FIELD_IDS.cliproxyCallbackUrl}
            aria-label="CLIProxy callback URL"
            className="input settings-input-compact"
            placeholder="Вставьте callback URL целиком"
            value={callbackUrlDraft}
            onChange={(event) => setCallbackUrlDraft(event.target.value)}
          />
          <input
            id={PROVIDERS_TAB_FIELD_IDS.cliproxyCode}
            name={PROVIDERS_TAB_FIELD_IDS.cliproxyCode}
            aria-label="CLIProxy OAuth code"
            className="input settings-input-compact"
            placeholder="Или отдельно code"
            value={codeDraft}
            onChange={(event) => setCodeDraft(event.target.value)}
          />
          <input
            id={PROVIDERS_TAB_FIELD_IDS.cliproxyState}
            name={PROVIDERS_TAB_FIELD_IDS.cliproxyState}
            aria-label="CLIProxy OAuth state"
            className="input settings-input-compact"
            placeholder="state"
            value={stateDraft}
            onChange={(event) => setStateDraft(event.target.value)}
          />

          <button
            className="btn primary"
            type="button"
            disabled={props.isSubmitting || !selectedProvider}
            onClick={() => {
              if (!selectedProvider) {
                return;
              }
              props.onCompleteAuth({
                provider: selectedProvider,
                callbackUrl: callbackUrlDraft.trim() || undefined,
                code: codeDraft.trim() || undefined,
                state: stateDraft.trim() || undefined
              });
            }}
          >
            {props.isSubmitting ? "Submitting..." : "Завершить подключение"}
          </button>
        </>
      ) : null}

      {pendingDeleteAccount ? (
        <DangerConfirmModal
          title="Удалить CLIProxy аккаунт?"
          description="Mini App удалит auth file этого аккаунта из CLIProxy. Если он понадобится снова, авторизацию придется пройти заново."
          subjectLabel="Выбранный аккаунт"
          subjectTitle={pendingDeleteAccount.name}
          subjectMeta={[pendingDeleteAccount.providerLabel, pendingDeleteAccount.status ?? "unknown"]}
          cancelLabel="Оставить аккаунт"
          confirmLabel="Удалить аккаунт"
          confirmBusyLabel="Удаляем аккаунт..."
          isBusy={props.isSubmitting}
          onClose={() => setPendingDeleteAccountId(null)}
          onConfirm={async () => {
            /* Close only after the current CLIProxy mutation finishes so repeated taps cannot double-submit deletion. */
            await props.onDeleteAccount(pendingDeleteAccount.id);
            setPendingDeleteAccountId(null);
          }}
        />
      ) : null}
    </div>
  );
};
