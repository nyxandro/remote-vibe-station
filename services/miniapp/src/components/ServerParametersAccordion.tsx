/**
 * @fileoverview Settings accordion that displays host server diagnostics metrics.
 *
 * Exports:
 * - ServerParametersAccordion - Renders CPU/RAM/disk/network cards and reload action.
 */

import { SystemMetricsSnapshot } from "../types";

type Props = {
  metrics: SystemMetricsSnapshot | null;
  isLoading: boolean;
  onReload: () => void;
};

const BYTES_IN_MEGABYTE = 1024 * 1024;
const BYTES_IN_GIGABYTE = BYTES_IN_MEGABYTE * 1024;

const toFixedBytes = (bytes: number, unit: "MB" | "GB"): string => {
  /* Use binary units so values match Linux memory/disk semantics. */
  const divider = unit === "GB" ? BYTES_IN_GIGABYTE : BYTES_IN_MEGABYTE;
  return `${(bytes / divider).toFixed(2)} ${unit}`;
};

export const ServerParametersAccordion = (props: Props) => {
  /* Keep null state explicit to avoid showing stale metrics before first load. */
  const lastCaptured = props.metrics ? new Date(props.metrics.capturedAt).toLocaleString() : "not loaded";

  return (
    <details className="settings-accordion-item">
      <summary>8. Параметры сервера</summary>
      <div className="settings-accordion-body">
        <div className="settings-actions-grid">
          <button className="btn outline" onClick={props.onReload} disabled={props.isLoading} type="button">
            {props.isLoading ? "Loading..." : "Reload server metrics"}
          </button>
        </div>

        <div className="project-create-note">Updated: {lastCaptured}</div>

        {!props.metrics ? (
          <div className="placeholder">Server metrics are not loaded yet.</div>
        ) : (
          <div className="server-metrics-grid">
            <div className="server-metrics-card">
              <div className="server-metrics-title">CPU</div>
              <div>CPU cores: {props.metrics.cpu.cores}</div>
              <div>Load 1m: {props.metrics.cpu.load1.toFixed(2)}</div>
              <div>Load 5m: {props.metrics.cpu.load5.toFixed(2)}</div>
              <div>Load 15m: {props.metrics.cpu.load15.toFixed(2)}</div>
            </div>

            <div className="server-metrics-card">
              <div className="server-metrics-title">RAM</div>
              <div>RAM total: {toFixedBytes(props.metrics.memory.totalBytes, "GB")}</div>
              <div>RAM used: {toFixedBytes(props.metrics.memory.usedBytes, "GB")}</div>
              <div>RAM free: {toFixedBytes(props.metrics.memory.freeBytes, "GB")}</div>
              <div>RAM used %: {`${props.metrics.memory.usedPercent.toFixed(2)}%`}</div>
            </div>

            <div className="server-metrics-card">
              <div className="server-metrics-title">Disk</div>
              <div>Disk path: {props.metrics.disk.rootPath}</div>
              <div>Disk total: {toFixedBytes(props.metrics.disk.totalBytes, "GB")}</div>
              <div>Disk used: {toFixedBytes(props.metrics.disk.usedBytes, "GB")}</div>
              <div>Disk free: {toFixedBytes(props.metrics.disk.freeBytes, "GB")}</div>
            </div>

            <div className="server-metrics-card">
              <div className="server-metrics-title">Network</div>
              <div>Active interfaces: {props.metrics.network.interfaces}</div>
              <div>Network RX: {toFixedBytes(props.metrics.network.rxBytes, "MB")}</div>
              <div>Network TX: {toFixedBytes(props.metrics.network.txBytes, "MB")}</div>
            </div>
          </div>
        )}
      </div>
    </details>
  );
};
