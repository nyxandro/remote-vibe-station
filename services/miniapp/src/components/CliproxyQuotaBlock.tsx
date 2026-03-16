/**
 * @fileoverview Live quota presentation for CLIProxy account cards.
 *
 * Exports:
 * - CliproxyQuotaBlock - Renders live quota windows when available and falls back to availability status otherwise.
 */

import { CliproxyAccountState } from "../types";

type CliproxyAccount = CliproxyAccountState["accounts"][number];
type CliproxyQuotaWindow = NonNullable<CliproxyAccount["quota"]>["windows"][number];

type Props = {
  account: CliproxyAccount;
  fallbackLabel: string;
  fallbackValue: number;
  formatDuration: (seconds: number) => string;
};

const formatResetText = (
  window: CliproxyQuotaWindow,
  formatDuration: (seconds: number) => string
): string | null => {
  /* Reset hints should prefer absolute timestamps, then degrade to human-readable countdowns. */
  if (window.resetAt) {
    const parsed = new Date(window.resetAt);
    if (!Number.isNaN(parsed.getTime())) {
      return `Сброс: ${parsed.toLocaleString()}`;
    }
  }

  if (typeof window.resetAfterSeconds === "number" && Number.isFinite(window.resetAfterSeconds)) {
    return `Сброс через ${formatDuration(window.resetAfterSeconds)}`;
  }

  return null;
};

export const CliproxyQuotaBlock = (props: Props) => {
  const liveQuota = props.account.quota;

  /* When live upstream quota windows exist, show every tracked limit instead of the old binary status bar. */
  if (props.fallbackValue > 0 && liveQuota?.mode === "live" && liveQuota.windows.length > 0) {
    return (
      <div className="providers-usage-block">
        <div className="project-create-note">Квота: live</div>
        {liveQuota.planType ? <div className="project-create-note">Тариф: {liveQuota.planType}</div> : null}
        {liveQuota.windows.map((window) => {
          const resetText = formatResetText(window, props.formatDuration);
          const remainingLabel = `${window.remainingPercent}% осталось`;

          return (
            <div key={`${props.account.id}:${window.id}`} style={{ marginTop: 8 }}>
              <div className="project-create-note">
                {window.label}: {remainingLabel}
              </div>
              {resetText ? <div className="project-create-note">{resetText}</div> : null}
              <div
                className="providers-usage-meter"
                role="progressbar"
                aria-label={`Quota ${window.label} for ${props.account.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={window.remainingPercent}
                aria-valuetext={`${window.label}: ${remainingLabel}`}
              >
                <div
                  className="providers-usage-meter-fill"
                  style={{ width: `${window.remainingPercent}%` }}
                />
                <span className="providers-usage-meter-text">{remainingLabel}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  /* Unsupported providers still show the availability-based fallback so account cards never go blank. */
  return (
    <div className="providers-usage-block">
      <div className="project-create-note">Квота: {props.fallbackLabel}</div>
      <div
        className="providers-usage-meter"
        role="progressbar"
        aria-label={`Quota state for ${props.account.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={props.fallbackValue}
        aria-valuetext={props.fallbackLabel}
      >
        <div className="providers-usage-meter-fill" style={{ width: `${props.fallbackValue}%` }} />
        <span className="providers-usage-meter-text">{props.fallbackLabel}</span>
      </div>
    </div>
  );
};
