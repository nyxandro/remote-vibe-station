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
  const latestStatus = props.snapshot?.updateAvailable ? "Update available" : "No update detected";
  const isBusy = props.isLoading || props.isChecking || props.isUpdating || props.isRollingBack;

  return (
    <div className="runtime-version-panel">
      <div className="project-create-note">Update Remote Vibe Station images from versioned GHCR tags.</div>

      <article className="runtime-version-row">
        <div>
          <div className="runtime-version-label">Installed</div>
          <div className="runtime-version-value">{props.snapshot?.currentVersion ?? "unknown"}</div>
        </div>
        <div className="runtime-version-meta">
          <span>Commit: {props.snapshot?.currentCommitSha ?? "not recorded"}</span>
          <span>Runtime dir: {props.snapshot?.runtimeConfigDir ?? "not mounted"}</span>
        </div>
      </article>

      <article className="runtime-version-row runtime-version-row-actions">
        <div>
          <div className="runtime-version-label">Latest release</div>
          <div className="runtime-version-value">{props.snapshot?.latestVersion ?? "checking..."}</div>
          <div className="project-create-note">
            {props.isChecking ? "Checking GitHub master image tag..." : latestStatus}
          </div>
        </div>
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
      </article>

      {props.lastResult === "updated" ? <div className="project-create-note">Runtime update started successfully.</div> : null}
      {props.lastResult === "rolled-back" ? <div className="project-create-note">Runtime rollback started successfully.</div> : null}
      {props.lastResult === "noop" ? <div className="project-create-note">Runtime is already up to date.</div> : null}
    </div>
  );
};
