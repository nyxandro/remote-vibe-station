/**
 * @fileoverview CLIProxy account management section for Providers tab.
 *
 * Exports:
 * - CliproxyAccountsSection (L36) - Renders account cards, manual switch/delete actions, and OAuth completion form.
 */

import { useEffect, useMemo, useState } from "react";

import { CliproxyAccountState, CliproxyOAuthStartPayload } from "../types";
import { PROVIDERS_TAB_FIELD_IDS } from "./providers-tab-field-ids";

type Props = {
  accounts: CliproxyAccountState | null;
  oauthStart: CliproxyOAuthStartPayload | null;
  isLoading: boolean;
  isSubmitting: boolean;
  onReload: () => void;
  onStartAuth: (provider: CliproxyAccountState["providers"][number]["id"]) => void;
  onCompleteAuth: (input: {
    provider: CliproxyAccountState["providers"][number]["id"];
    callbackUrl?: string;
    code?: string;
    state?: string;
    error?: string;
  }) => void;
  onActivateAccount: (accountId: string) => void;
  onDeleteAccount: (accountId: string) => void;
};

export const CliproxyAccountsSection = (props: Props) => {
  const [callbackUrlDraft, setCallbackUrlDraft] = useState<string>("");
  const [codeDraft, setCodeDraft] = useState<string>("");
  const [stateDraft, setStateDraft] = useState<string>("");

  useEffect(() => {
    /* Starting a new auth flow must reset callback drafts from previous attempts. */
    setCallbackUrlDraft("");
    setCodeDraft("");
    setStateDraft(props.oauthStart?.state ?? "");
  }, [props.oauthStart]);

  const selectedProvider = props.oauthStart?.provider;

  const getCliproxyAccountDetails = (account: CliproxyAccountState["accounts"][number]): string[] => {
    /* CLIProxy may duplicate identity data across fields, so collapse repeated values for one concise card. */
    const uniqueDetails = new Set<string>();

    [account.email ?? account.name, account.account, account.label, account.statusMessage].forEach((value) => {
      const normalized = String(value ?? "").trim();
      if (normalized) {
        uniqueDetails.add(normalized);
      }
    });

    return Array.from(uniqueDetails);
  };

  const maxTrackedTokens = useMemo(() => {
    /* Relative bar uses the busiest observed account as 100% to avoid implying real provider quota. */
    return Math.max(0, ...(props.accounts?.accounts ?? []).map((account) => account.usage.tokenCount));
  }, [props.accounts]);

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

  const getUsageActivityPercent = (account: CliproxyAccountState["accounts"][number]): number => {
    /* Activity bar is relative only to observed usage inside the current account pool. */
    if (maxTrackedTokens <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round((account.usage.tokenCount / maxTrackedTokens) * 100)));
  };

  const getUsageRemainingPercent = (account: CliproxyAccountState["accounts"][number]): number => {
    /* We show the remaining gap to the busiest account because Mini App has no real provider quota limit. */
    return Math.max(0, 100 - getUsageActivityPercent(account));
  };

  return (
    <div className="providers-auth-card">
      {/* CLIProxy onboarding and account steering stay together so operators manage one pool in one place. */}
      <div className="settings-header-row">
        <strong>CLIProxy accounts</strong>
        <button className="btn outline" onClick={props.onReload} disabled={props.isLoading} type="button">
          {props.isLoading ? "Loading..." : "Reload accounts"}
        </button>
      </div>

      <div className="project-create-note">
        Здесь отображаются аккаунты, уже подключенные внутри CLIProxy. Можно вручную сделать один аккаунт активным или удалить ненужный auth file.
      </div>

      {!props.accounts?.usageTrackingEnabled ? (
        <div className="project-create-note">
          CLIProxy: наблюдаемая статистика usage выключена, поэтому активность по аккаунтам пока не собирается.
        </div>
      ) : null}

      <div className="providers-list">
        {props.accounts?.accounts.map((account) => {
          const limitPercent = getUsageRemainingPercent(account);
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
              {props.accounts?.usageTrackingEnabled ? (
                <div className="providers-usage-block">
                  <div className="project-create-note">
                    Limit: {limitPercent}%
                  </div>
                  <div
                    className="providers-usage-meter"
                    role="progressbar"
                    aria-label={`Limit for ${account.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={limitPercent}
                    aria-valuetext={`Limit ${limitPercent}%`}
                  >
                    <div
                      className="providers-usage-meter-fill"
                      style={{ width: `${limitPercent}%` }}
                    />
                    <span className="providers-usage-meter-text">
                      Limit {limitPercent}%
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Account actions stay explicit because activation disables same-provider siblings on the backend. */}
              {account.canManage ? (
                <div className="providers-action-row">
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
                    onClick={() => {
                      if (window.confirm(`Удалить аккаунт ${account.name}?`)) {
                        props.onDeleteAccount(account.id);
                      }
                    }}
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
    </div>
  );
};
