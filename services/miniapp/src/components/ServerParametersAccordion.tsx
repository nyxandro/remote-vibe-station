/**
 * @fileoverview Settings accordion that displays host server diagnostics metrics with visual status bars and charts.
 * 
 * Exports:
 * - ServerParametersAccordion - Renders visual CPU/RAM/disk/network cards with load-aware color coding.
 */

import { SystemMetricsSnapshot } from "../types";

type Props = {
  metrics: SystemMetricsSnapshot | null;
  isLoading: boolean;
  onReload: () => void;
};

const BYTES_IN_MEGABYTE = 1024 * 1024;
const BYTES_IN_GIGABYTE = BYTES_IN_MEGABYTE * 1024;

/** Format bytes to human readable string using binary units. */
const toFixedBytes = (bytes: number, unit: "MB" | "GB"): string => {
  const divider = unit === "GB" ? BYTES_IN_GIGABYTE : BYTES_IN_MEGABYTE;
  return `${(bytes / divider).toFixed(2)} ${unit}`;
};

/** Get status color class based on percentage. */
const getStatusClass = (percent: number): string => {
  if (percent >= 90) return "error";
  if (percent >= 70) return "warning";
  return "success";
};

export const ServerParametersAccordion = (props: Props) => {
  const lastCaptured = props.metrics ? new Date(props.metrics.capturedAt).toLocaleString() : "не загружено";

  return (
    <details className="settings-accordion-item">
      <summary>8. Параметры сервера</summary>
      <div className="settings-accordion-body">
        <div className="settings-actions-grid">
          <button className="btn outline" onClick={props.onReload} disabled={props.isLoading} type="button">
            {props.isLoading ? "Загрузка..." : "Обновить метрики"}
          </button>
        </div>

        <div className="project-create-note">Обновлено: {lastCaptured}</div>

        {!props.metrics ? (
          <div className="placeholder">Метрики сервера еще не загружены.</div>
        ) : (
          <div className="server-metrics-grid">
            {/* CPU Loading Section - Visualizes LA as mini bar chart */}
            <div className="server-metrics-card">
              <div className="server-metrics-title">
                CPU
                <span className="metric-label">{props.metrics.cpu.cores} cores</span>
              </div>
              
              <div className="cpu-load-chart">
                {[
                  { label: "1m", val: props.metrics.cpu.load1 },
                  { label: "5m", val: props.metrics.cpu.load5 },
                  { label: "15m", val: props.metrics.cpu.load15 }
                ].map((item) => {
                  /* Calculate height relative to core count (100% means full core saturation) */
                  const saturation = (item.val / props.metrics!.cpu.cores) * 100;
                  const height = Math.min(Math.max(saturation, 10), 100);
                  const color = item.val >= props.metrics!.cpu.cores ? "#ef4444" : item.val >= props.metrics!.cpu.cores * 0.7 ? "#f59e0b" : "#10b981";
                  
                  return (
                    <div className="cpu-load-bar-group" key={item.label}>
                      <div className="cpu-load-bar-track">
                        <div 
                          className="cpu-load-bar-fill" 
                          style={{ height: `${height}%`, background: color }} 
                        />
                      </div>
                      <div className="cpu-load-label">{item.label}</div>
                    </div>
                  );
                })}
              </div>

              <div className="metric-row">
                <span className="metric-label">Max Load:</span>
                <span className="metric-value">{props.metrics.cpu.load1.toFixed(2)}</span>
              </div>
            </div>

            {/* RAM Usage Section - Progress bar used/total */}
            <div className="server-metrics-card">
              <div className="server-metrics-title">RAM</div>
              
              <div className="metric-progress-container">
                <div className="metric-row">
                  <span className="metric-label">Занято</span>
                  <span className="metric-value">{props.metrics.memory.usedPercent.toFixed(1)}%</span>
                </div>
                <div className="metric-progress-bar">
                  <div 
                    className={`metric-progress-fill ${getStatusClass(props.metrics.memory.usedPercent)}`}
                    style={{ width: `${props.metrics.memory.usedPercent}%` }}
                  />
                </div>
              </div>

              <div className="metric-row">
                <span className="metric-label">Всего:</span>
                <span className="metric-value">{toFixedBytes(props.metrics.memory.totalBytes, "GB")}</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">Свободно:</span>
                <span className="metric-value">{toFixedBytes(props.metrics.memory.freeBytes, "GB")}</span>
              </div>
            </div>

            {/* Disk Usage Section - Progress bar used/total */}
            <div className="server-metrics-card">
              <div className="server-metrics-title">DISK</div>
              
              <div className="metric-progress-container">
                <div className="metric-row">
                  <span className="metric-label">Использовано</span>
                  <span className="metric-value">{props.metrics.disk.usedPercent.toFixed(1)}%</span>
                </div>
                <div className="metric-progress-bar">
                  <div 
                    className={`metric-progress-fill ${getStatusClass(props.metrics.disk.usedPercent)}`}
                    style={{ width: `${props.metrics.disk.usedPercent}%` }}
                  />
                </div>
              </div>

              <div className="metric-row">
                <span className="metric-label">Путь:</span>
                <span className="metric-value" style={{ fontSize: "10px", wordBreak: "break-all" }}>{props.metrics.disk.rootPath}</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">Всего:</span>
                <span className="metric-value">{toFixedBytes(props.metrics.disk.totalBytes, "GB")}</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">Свободно:</span>
                <span className="metric-value">{toFixedBytes(props.metrics.disk.freeBytes, "GB")}</span>
              </div>
            </div>

            {/* Network Activity Section - I/O counters */}
            <div className="server-metrics-card">
              <div className="server-metrics-title">
                NETWORK
                <div className={`metric-status-dot ${props.metrics.network.interfaces > 0 ? "active" : ""}`} />
              </div>

              <div className="metric-row" style={{ marginTop: "6px" }}>
                <span className="metric-label">Interfaces:</span>
                <span className="metric-value">{props.metrics.network.interfaces}</span>
              </div>

              <div className="metric-row">
                <span className="metric-label">Received (RX):</span>
                <span className="metric-value">{toFixedBytes(props.metrics.network.rxBytes, "MB")}</span>
              </div>
              <div className="metric-row">
                <span className="metric-label">Sent (TX):</span>
                <span className="metric-value">{toFixedBytes(props.metrics.network.txBytes, "MB")}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </details>
  );
};
