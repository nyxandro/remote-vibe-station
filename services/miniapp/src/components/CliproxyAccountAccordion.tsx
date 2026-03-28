/**
 * @fileoverview Compact accordion card for one CLIProxy account.
 *
 * Exports:
 * - CliproxyAccountAccordion - Renders a collapsed summary with one quota meter and reveals diagnostics/actions on demand.
 */

import { ChevronDown } from "lucide-react";

import { CliproxyAccountState } from "../types";
import {
  buildCliproxyAccountViewModel,
  formatCliproxyUsageDate,
  formatCliproxyUsageNumber
} from "./cliproxy-account-view";

type CliproxyAccount = CliproxyAccountState["accounts"][number];

type Props = {
  account: CliproxyAccount;
  isExpanded: boolean;
  isSubmitting: boolean;
  onToggle: () => void;
  onTestAccount: (accountId: string) => void;
  onActivateAccount: (accountId: string) => void;
  onRequestDelete: (accountId: string) => void;
};

export const CliproxyAccountAccordion = (props: Props) => {
  const view = buildCliproxyAccountViewModel(props.account);
  const detailsId = `cliproxy-account-details:${props.account.id}`;
  const toggleLabel = `${props.isExpanded ? "Свернуть" : "Развернуть"} аккаунт ${props.account.providerLabel}`;

  return (
    <div className={`providers-item-card providers-account-card${props.isExpanded ? " expanded" : ""}`}>
      {/* The whole summary stays clickable so dense account lists remain fast to scan and open on mobile. */}
      <button
        className="providers-account-summary"
        type="button"
        aria-controls={detailsId}
        aria-expanded={props.isExpanded}
        aria-label={toggleLabel}
        onClick={props.onToggle}
      >
        <span className="providers-account-summary-top">
          <span className="providers-account-summary-heading">
            <span className="providers-item-name">{props.account.providerLabel}</span>
            <span className="providers-account-summary-identity">{view.primaryIdentity}</span>
          </span>

          <span className="providers-account-summary-side">
            <span className={`providers-badge ${view.statusBadge.tone}`}>{view.statusBadge.label}</span>
            <span className="providers-account-chevron" aria-hidden="true">
              <ChevronDown size={16} />
            </span>
          </span>
        </span>

        <span className="providers-account-quota-summary">
          <span className="providers-account-quota-label">Лимит: {view.quota.label}</span>
          <span
            className="providers-usage-meter providers-account-summary-meter"
            role="progressbar"
            aria-label={view.quota.ariaLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={view.quota.value}
            aria-valuetext={view.quota.ariaValueText}
          >
            <span className="providers-usage-meter-fill" style={{ width: `${view.quota.value}%` }} />
            <span className="providers-usage-meter-text">{view.quota.meterText}</span>
          </span>
        </span>
      </button>

      {props.isExpanded ? (
        <div id={detailsId} className="providers-account-body">
          {/* Expanded content keeps the original diagnostics, but only for the currently inspected account. */}
          {view.extraDetails.map((detail) => (
            <div key={`${props.account.id}:${detail}`} className="project-create-note providers-account-detail">
              {detail}
            </div>
          ))}

          {props.account.unavailable ? (
            <div className="project-create-note">Недоступен для запросов прямо сейчас.</div>
          ) : null}
          {view.quota.resetText ? <div className="project-create-note">{view.quota.resetText}</div> : null}

          <div className="providers-account-metrics">
            <div className="project-create-note">Запросы: {formatCliproxyUsageNumber(props.account.usage.requestCount)}</div>
            <div className="project-create-note">Токены: {formatCliproxyUsageNumber(props.account.usage.tokenCount)}</div>
            <div className="project-create-note">
              Ошибки: {formatCliproxyUsageNumber(props.account.usage.failedRequestCount)}
            </div>
            <div className="project-create-note">
              Последняя активность: {formatCliproxyUsageDate(props.account.usage.lastUsedAt)}
            </div>
            {props.account.usage.models.length > 0 ? (
              <div className="project-create-note">Модели: {props.account.usage.models.join(", ")}</div>
            ) : null}
          </div>

          {/* Account mutations stay tucked inside the expanded body so collapsed cards remain compact. */}
          {props.account.canManage ? (
            <div className="providers-action-row">
              <button
                className="btn outline"
                type="button"
                disabled={props.isSubmitting}
                onClick={() => props.onTestAccount(props.account.id)}
              >
                Тест
              </button>
              <button
                className="btn outline"
                type="button"
                disabled={props.isSubmitting || (!props.account.disabled && !props.account.unavailable)}
                onClick={() => props.onActivateAccount(props.account.id)}
              >
                {props.account.disabled || props.account.unavailable ? "Сделать активным" : "Активен"}
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={props.isSubmitting}
                onClick={() => props.onRequestDelete(props.account.id)}
              >
                Удалить
              </button>
            </div>
          ) : (
            <div className="project-create-note">Этот аккаунт нельзя изменять из Mini App.</div>
          )}
        </div>
      ) : null}
    </div>
  );
};
