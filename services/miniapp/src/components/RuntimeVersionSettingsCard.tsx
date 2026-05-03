/**
 * @fileoverview Runtime update card for Settings dashboard.
 *
 * Exports:
 * - RuntimeVersionSettingsCard - Shows installed runtime version and update/rollback controls.
 */

import { RuntimeVersionSnapshot } from "../types";

type Props = {
  snapshot: RuntimeVersionSnapshot | null;
  isLoading: boolean;
  isChecking: boolean;
  isUpdating: boolean;
  isRollingBack: boolean;
  lastResult: "idle" | "updated" | "rolled-back" | "noop";
  onLoad: () => void;
  onCheck: () => void;
  onUpdate: () => void;
  onRollback: () => void;
};

export const RuntimeVersionSettingsCard = (props: Props) => {
  const currentVersion = props.snapshot?.currentVersion ?? "Unknown";
  const latestVersion = props.snapshot?.latestVersion ?? "Not checked";
  const latestStatus = props.snapshot?.updateAvailable ? "Update available" : "Up to date";
  const statusClassName = props.snapshot?.updateAvailable
    ? "runtime-version-status update"
    : "runtime-version-status ok";
  const isBusy = props.isLoading || props.isChecking || props.isUpdating || props.isRollingBack;

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
        <span className={statusClassName}>{props.isChecking ? "Checking" : latestStatus}</span>
      </article>

      <div className="settings-actions-grid runtime-version-actions">
        <button className="btn outline" disabled={props.isLoading} onClick={props.onLoad} type="button">
          {props.isLoading ? "Loading..." : "Reload"}
        </button>
        <button className="btn outline" disabled={props.isChecking} onClick={props.onCheck} type="button">
          {props.isChecking ? "Checking..." : "Check"}
        </button>
        <button
          className="btn"
          disabled={!props.snapshot?.updateAvailable || isBusy}
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
