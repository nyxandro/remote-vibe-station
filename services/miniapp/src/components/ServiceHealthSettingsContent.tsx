/**
 * @fileoverview Service-specific content blocks rendered inside the runtime health modal.
 *
 * Exports:
 * - ServiceHealthSettingsContent - Renders OpenCode/CLIProxy details for selected service.
 */

import { ManagedRuntimeServiceId, OpenCodeSettingsOverview, OpenCodeVersionStatus, ProxySettingsSnapshot, RuntimeServiceSnapshot, CliproxyAccountState } from "../types";

type Props = {
  service: RuntimeServiceSnapshot;
  overview: OpenCodeSettingsOverview | null;
  onOpenFile: (kind: "config") => void;
  onRefreshProjects: () => void;
  onSyncProjects: () => void;
  onRestartOpenCode: () => void;
  restartOpenCodeState: {
    isRestarting: boolean;
    lastResult: "idle" | "success" | "error";
  };
  openCodeVersion?: {
    status: OpenCodeVersionStatus | null;
    isLoading: boolean;
    isUpdating: boolean;
  };
  onUpdateOpenCodeVersion?: () => void;
  proxyState?: {
    snapshot: ProxySettingsSnapshot | null;
    accounts: CliproxyAccountState | null;
    isApplying: boolean;
    onApply: () => void;
  };
};

const formatCountLabel = (count: number, noun: string): string => {
  /* Modal summary copy stays compact and readable for small account/service counters. */
  return `${count} ${noun}`;
};

const countAccountsByState = (accounts: CliproxyAccountState | null, predicate: (status: string | null) => boolean): number => {
  /* CLIProxy modal needs fast account counts without reimplementing list UIs from Providers tab. */
  if (!accounts) {
    return 0;
  }

  return accounts.accounts.filter((account) => predicate(account.status)).length;
};

const isOpenCodeService = (serviceId: ManagedRuntimeServiceId): boolean => serviceId === "opencode";

export const ServiceHealthSettingsContent = (props: Props) => {
  /* OpenCode and CLIProxy get actionable controls; Mini App and Bot stay diagnostics-only. */
  if (isOpenCodeService(props.service.id)) {
    return (
      <>
        <div className="settings-actions-grid">
          <button className="btn outline" onClick={() => props.onOpenFile("config")} type="button">
            OpenCode config
          </button>
          <button className="btn outline" onClick={props.onRefreshProjects} type="button">
            Refresh project list
          </button>
          <button className="btn outline" onClick={props.onSyncProjects} type="button">
            Sync OpenCode
          </button>
          <button
            className="btn outline"
            onClick={props.onRestartOpenCode}
            disabled={props.restartOpenCodeState.isRestarting}
            type="button"
          >
            {props.restartOpenCodeState.isRestarting ? "Restarting OpenCode..." : "Restart OpenCode"}
          </button>
          <button
            className="btn outline"
            onClick={() => props.onUpdateOpenCodeVersion?.()}
            disabled={!props.openCodeVersion?.status?.updateAvailable || props.openCodeVersion?.isUpdating || !props.onUpdateOpenCodeVersion}
            type="button"
          >
            {props.openCodeVersion?.isUpdating ? "Updating..." : "Update OpenCode"}
          </button>
        </div>

        <div className="project-create-note">OpenCode config: {props.overview?.config.absolutePath ?? "Unavailable"}</div>
        <div className="project-create-note">Current version: {props.openCodeVersion?.status?.currentVersion ?? "unknown"}</div>
        <div className="project-create-note">Latest version: {props.openCodeVersion?.status?.latestVersion ?? "not checked"}</div>
      </>
    );
  }

  if (props.service.id === "cliproxy") {
    const snapshot = props.proxyState?.snapshot;
    const accounts = props.proxyState?.accounts ?? null;
    const activeAccounts = countAccountsByState(accounts, (status) => status === "active");
    const erroredAccounts = countAccountsByState(accounts, (status) => status === "error");

    return (
      <>
        <div className="settings-actions-grid">
          <button
            className="btn outline"
            onClick={props.proxyState?.onApply}
            disabled={!props.proxyState || props.proxyState.isApplying}
            type="button"
          >
            {props.proxyState?.isApplying ? "Applying runtime..." : "Apply proxy runtime"}
          </button>
        </div>

        <div className="project-create-note">Mode: {snapshot?.mode ?? "unknown"}</div>
        <div className="project-create-note">HTTP_PROXY: {snapshot?.envPreview.HTTP_PROXY ?? "(disabled)"}</div>
        <div className="project-create-note">HTTPS_PROXY: {snapshot?.envPreview.HTTPS_PROXY ?? "(disabled)"}</div>
        <div className="project-create-note">NO_PROXY: {snapshot?.envPreview.NO_PROXY ?? "(disabled)"}</div>
        <div className="project-create-note">Accounts: {formatCountLabel(accounts?.accounts.length ?? 0, "total")}</div>
        <div className="project-create-note">Active accounts: {formatCountLabel(activeAccounts, "active")}</div>
        <div className="project-create-note">Errored accounts: {formatCountLabel(erroredAccounts, "error")}</div>
      </>
    );
  }

  return <div className="project-create-note">Diagnostics only. Restart is intentionally hidden here to keep the current control channel stable.</div>;
};
