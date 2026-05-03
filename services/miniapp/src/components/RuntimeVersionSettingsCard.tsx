/**
 * @fileoverview Runtime update card for Settings dashboard.
 *
 * Exports:
 * - RuntimeVersionSettingsCard - Shows installed runtime version and update/rollback controls.
 */

import { RuntimeUpdateState, RuntimeVersionSnapshot } from "../types";

type Props = {
  snapshot: RuntimeVersionSnapshot | null;
  isLoading: boolean;
  isChecking: boolean;
  isUpdating: boolean;
  isRollingBack: boolean;
  isReconnecting: boolean;
  lastResult: "idle" | "updated" | "rolled-back" | "noop";
  updateState: RuntimeUpdateState | null;
  onLoad: () => void;
  onCheck: () => void;
  onUpdate: () => void;
  onRollback: () => void;
};

export const RuntimeVersionSettingsCard = (props: Props) => {
  const currentVersion = props.snapshot?.currentVersion ?? "Unknown";
  const latestVersion = props.snapshot?.latestVersion ?? "Not checked";
  const effectiveStatus = props.isReconnecting ? "Restarting..." : props.updateState?.status === "completed" ? "Updated" : props.snapshot?.updateAvailable ? "Update available" : "Up to date";
  const statusClassName = props.isReconnecting || props.updateState?.status === "updating" || props.updateState?.status === "restarting"
    ? "runtime-version-status progress"
    : props.snapshot?.updateAvailable
    ? "runtime-version-status update"
    : "runtime-version-status ok";
  const isBusy = props.isLoading || props.isChecking || props.isUpdating || props.isRollingBack;
  const showProgress = props.isReconnecting || props.updateState?.status === "updating" || props.updateState?.status === "restarting" || props.updateState?.status === "completed" || props.updateState?.status === "failed";

  return (
    <div className="runtime-version-panel">
      <article className="runtime-version-summary">
        <div className="runtime-version-pair">
          <span className="runtime-version-label">Current</span>
          <strong className="runtime-version-value">{currentVersion}</strong>
        </div>
        <div className="runtime-version-pair">
          <span className="runtime-version-label">Latest</span>
          <strong className="runtime-version-value">{props.isChecking ? "Checking..." : latestVersion}</strong>
        </div>
        <span className={statusClassName}>{props.isChecking ? "Checking" : effectiveStatus}</span>
      </article>

      {showProgress ? (
        <article className="runtime-update-progress" aria-live="polite">
          <strong>{props.isReconnecting ? "Restarting services..." : props.updateState?.status === "completed" ? "Update completed" : props.updateState?.status === "failed" ? "Update failed" : "Updating runtime"}</strong>
          <div className="project-create-note">
            {props.isReconnecting ? "Connection can disappear during update. Mini App will reconnect automatically." : props.updateState?.targetVersion ? `Target version: ${props.updateState.targetVersion}` : "Preparing update..."}
          </div>
          {props.updateState?.steps.length ? (
            <div className="runtime-update-steps">
              {props.updateState.steps.map((step) => (
                <span key={step.id} className={`runtime-update-step ${step.status}`}>
                  {step.label}
                </span>
              ))}
            </div>
          ) : null}
          {props.updateState?.error ? <div className="project-create-note">{props.updateState.error}</div> : null}
        </article>
      ) : null}

      <div className="settings-actions-grid runtime-version-actions">
        <button className="btn outline" disabled={props.isLoading} onClick={props.onLoad} type="button">
          {props.isLoading ? "Loading..." : "Reload"}
        </button>
        <button className="btn outline" disabled={props.isChecking} onClick={props.onCheck} type="button">
          {props.isChecking ? "Checking..." : "Check"}
        </button>
        <button
          className="btn"
          disabled={!props.snapshot?.updateAvailable || isBusy || props.isReconnecting}
          onClick={props.onUpdate}
          type="button"
        >
          {props.isUpdating ? "Updating..." : "Update runtime"}
        </button>
        <button
          className="btn outline danger"
          disabled={!props.snapshot?.rollbackAvailable || isBusy}
          onClick={props.onRollback}
          type="button"
        >
          {props.isRollingBack ? "Rolling back..." : "Rollback"}
        </button>
      </div>

      {props.lastResult === "updated" ? <div className="project-create-note">Runtime update started successfully.</div> : null}
      {props.lastResult === "rolled-back" ? <div className="project-create-note">Runtime rollback started successfully.</div> : null}
      {props.lastResult === "noop" ? <div className="project-create-note">Runtime is already up to date.</div> : null}
    </div>
  );
};
