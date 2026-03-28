/**
 * @fileoverview Dashboard cards for critical runtime service health inside Settings.
 *
 * Exports:
 * - ServiceHealthDashboard - Renders service health cards with refresh and quick-open interactions.
 */

import "../service-health.css";

import { RuntimeServiceSnapshot, RuntimeServicesSnapshot, ManagedRuntimeServiceId } from "../types";

type Props = {
  snapshot: RuntimeServicesSnapshot | null;
  isLoading: boolean;
  restartingByService: Partial<Record<ManagedRuntimeServiceId, boolean>>;
  onReload: () => void;
  onSelectService: (service: RuntimeServiceSnapshot) => void;
};

const HEALTH_LABELS: Record<RuntimeServiceSnapshot["health"], string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  down: "Down"
};

const formatUpdatedAt = (value: string | null): string => {
  /* Dashboard header should always show when the snapshot was last captured. */
  if (!value) {
    return "not loaded";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const formatUptime = (seconds: number | null): string => {
  /* Compact card copy avoids noisy timestamps while still showing service age at a glance. */
  if (seconds == null) {
    return "Uptime unavailable";
  }

  if (seconds < 60) {
    return `${seconds}s uptime`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m uptime`;
  }

  return `${minutes}m uptime`;
};

export const ServiceHealthDashboard = (props: Props) => {
  return (
    <section className="service-health-shell">
      <div className="service-health-header-row">
        <div>
          <h4 className="service-health-title">Service health</h4>
          <div className="service-health-caption">Updated: {formatUpdatedAt(props.snapshot?.capturedAt ?? null)}</div>
        </div>

        <button className="btn outline" onClick={props.onReload} disabled={props.isLoading} type="button">
          {props.isLoading ? "Refreshing..." : "Refresh services"}
        </button>
      </div>

      {!props.snapshot ? (
        <div className="placeholder">Service health is not loaded yet.</div>
      ) : (
        <div className="service-health-grid">
          {props.snapshot.services.map((service) => (
            <button
              key={service.id}
              className={`service-health-card ${service.health}`}
              onClick={() => props.onSelectService(service)}
              type="button"
            >
              <div className="service-health-card-top">
                <div className="service-health-card-name">{service.label}</div>
                <span className={`service-health-pill ${service.health}`}>{HEALTH_LABELS[service.health]}</span>
              </div>

              <div className="service-health-meta">{service.containerName ?? "Container missing"}</div>
              <div className="service-health-meta">{formatUptime(service.uptimeSeconds)}</div>
              <div className="service-health-card-message">{service.message}</div>

              {props.restartingByService[service.id] ? (
                <div className="service-health-inline-action">Restarting...</div>
              ) : (
                <div className="service-health-inline-action">Open details</div>
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
};
