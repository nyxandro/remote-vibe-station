/**
 * @fileoverview Runtime service dashboard wrapper for Settings tab.
 *
 * Exports:
 * - SettingsRuntimeDashboard - Wires service cards, modal and service-specific actions.
 */

import { useState } from "react";

import {
  CliproxyAccountState,
  ManagedRuntimeServiceId,
  OpenCodeSettingsOverview,
  OpenCodeVersionStatus,
  ProxySettingsSnapshot,
  RuntimeServiceSnapshot,
  RuntimeServicesSnapshot
} from "../types";
import { ServiceHealthDashboard } from "./ServiceHealthDashboard";
import { ServiceHealthModal } from "./ServiceHealthModal";
import { ServiceHealthSettingsContent } from "./ServiceHealthSettingsContent";

type Props = {
  overview: OpenCodeSettingsOverview | null;
  openCodeVersion?: {
    status: OpenCodeVersionStatus | null;
    isLoading: boolean;
    isUpdating: boolean;
  };
  restartOpenCodeState: {
    isRestarting: boolean;
    lastResult: "idle" | "success" | "error";
  };
  runtimeServices: {
    snapshot: RuntimeServicesSnapshot | null;
    isLoading: boolean;
    restartingByService: Partial<Record<ManagedRuntimeServiceId, boolean>>;
  };
  proxyState?: {
    snapshot: ProxySettingsSnapshot | null;
    accounts: CliproxyAccountState | null;
    isApplying: boolean;
  };
  onReloadRuntimeServices: () => void;
  onRestartRuntimeService?: (serviceId: ManagedRuntimeServiceId) => void;
  onApplyProxyRuntime?: () => void;
  onOpenFile: (kind: "config") => void;
  onRefreshProjects: () => void;
  onSyncProjects: () => void;
  onRestartOpenCode: () => void;
  onUpdateOpenCodeVersion?: () => void;
};

const canRestartRuntimeService = (serviceId: ManagedRuntimeServiceId): boolean => {
  /* Only restart dependency services that do not immediately disrupt the current control channel. */
  return serviceId === "opencode" || serviceId === "cliproxy";
};

export const SettingsRuntimeDashboard = (props: Props) => {
  const [selectedRuntimeService, setSelectedRuntimeService] = useState<RuntimeServiceSnapshot | null>(null);

  return (
    <>
      <ServiceHealthDashboard
        snapshot={props.runtimeServices.snapshot}
        isLoading={props.runtimeServices.isLoading}
        restartingByService={props.runtimeServices.restartingByService}
        onReload={props.onReloadRuntimeServices}
        onSelectService={setSelectedRuntimeService}
      />

      <ServiceHealthModal
        service={selectedRuntimeService}
        canRestart={selectedRuntimeService ? canRestartRuntimeService(selectedRuntimeService.id) : false}
        isRestarting={Boolean(
          selectedRuntimeService && props.runtimeServices.restartingByService[selectedRuntimeService.id]
        )}
        onClose={() => setSelectedRuntimeService(null)}
        onRestart={() => {
          if (!selectedRuntimeService || !props.onRestartRuntimeService) {
            return;
          }

          props.onRestartRuntimeService(selectedRuntimeService.id);
        }}
      >
        {selectedRuntimeService ? (
          <ServiceHealthSettingsContent
            service={selectedRuntimeService}
            overview={props.overview}
            onOpenFile={props.onOpenFile}
            onRefreshProjects={props.onRefreshProjects}
            onSyncProjects={props.onSyncProjects}
            onRestartOpenCode={props.onRestartOpenCode}
            restartOpenCodeState={props.restartOpenCodeState}
            openCodeVersion={props.openCodeVersion}
            onUpdateOpenCodeVersion={props.onUpdateOpenCodeVersion}
            proxyState={
              props.proxyState
                ? {
                    snapshot: props.proxyState.snapshot,
                    accounts: props.proxyState.accounts,
                    isApplying: props.proxyState.isApplying,
                    onApply: props.onApplyProxyRuntime ?? (() => {})
                  }
                : undefined
            }
          />
        ) : null}
      </ServiceHealthModal>
    </>
  );
};
