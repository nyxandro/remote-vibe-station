/**
 * @fileoverview Settings accordion wrapper for station runtime image updates.
 *
 * Exports:
 * - RuntimeVersionSettingsAccordion - Renders runtime update status inside the Settings accordion shell.
 */

import { RuntimeVersionSnapshot } from "../types";
import { RuntimeVersionSettingsCard } from "./RuntimeVersionSettingsCard";

type Props = {
  runtimeVersion?: {
    snapshot: RuntimeVersionSnapshot | null;
    isLoading: boolean;
    isChecking: boolean;
    isUpdating: boolean;
    isRollingBack: boolean;
    lastResult: "idle" | "updated" | "rolled-back" | "noop";
  };
  onReloadRuntimeVersion?: () => void;
  onCheckRuntimeVersion?: () => void;
  onUpdateRuntime?: () => void;
  onRollbackRuntime?: () => void;
};

export const RuntimeVersionSettingsAccordion = (props: Props) => {
  return (
    <details className="settings-accordion-item" open>
      <summary>1. Runtime updates</summary>
      <div className="settings-accordion-body">
        {props.runtimeVersion ? (
          <RuntimeVersionSettingsCard
            snapshot={props.runtimeVersion.snapshot}
            isLoading={props.runtimeVersion.isLoading}
            isChecking={props.runtimeVersion.isChecking}
            isUpdating={props.runtimeVersion.isUpdating}
            isRollingBack={props.runtimeVersion.isRollingBack}
            lastResult={props.runtimeVersion.lastResult}
            onLoad={props.onReloadRuntimeVersion ?? (() => {})}
            onCheck={props.onCheckRuntimeVersion ?? (() => {})}
            onUpdate={props.onUpdateRuntime ?? (() => {})}
            onRollback={props.onRollbackRuntime ?? (() => {})}
          />
        ) : (
          <div className="placeholder">Runtime update status is not available.</div>
        )}
      </div>
    </details>
  );
};
