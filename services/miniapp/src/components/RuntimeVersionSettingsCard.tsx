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
  const isBusy = props.isLoading || props.isChecking || props.isUpdating || props.isRollingBack;

  return (
    <section className="service-health-dashboard">
      <div className="service-health-header">
        <div>
          <strong>Runtime updates</strong>
          <div className="project-create-note">Update Remote Vibe Station images from versioned GHCR tags.</div>
        </div>
        <button className="btn outline" disabled={props.isLoading} onClick={props.onLoad} type="button">
          {props.isLoading ? "Loading..." : "Reload"}
        </button>
      </div>

      <div className="service-health-grid">
        <article className="service-health-card">
          <div className="service-health-card-title">Installed</div>
          <div className="service-health-card-value">{props.snapshot?.currentVersion ?? "unknown"}</div>
          <div className="project-create-note">Commit: {props.snapshot?.currentCommitSha ?? "not recorded"}</div>
          <div className="project-create-note">Runtime dir: {props.snapshot?.runtimeConfigDir ?? "not mounted"}</div>
        </article>

        <article className="service-health-card">
          <div className="service-health-card-title">Latest release</div>
          <div className="service-health-card-value">{props.snapshot?.latestVersion ?? "not checked"}</div>
          <div className="project-create-note">
            {props.snapshot?.updateAvailable ? "Update available." : "No update detected."}
          </div>
          <div className="settings-actions-grid">
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
      </div>

      {props.lastResult === "updated" ? <div className="project-create-note">Runtime update started successfully.</div> : null}
      {props.lastResult === "rolled-back" ? <div className="project-create-note">Runtime rollback started successfully.</div> : null}
      {props.lastResult === "noop" ? <div className="project-create-note">Runtime is already up to date.</div> : null}
    </section>
  );
};
