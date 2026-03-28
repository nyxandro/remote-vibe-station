/**
 * @fileoverview Modal with detailed runtime service diagnostics and actions.
 *
 * Exports:
 * - ServiceHealthModal - Renders selected service details, diagnostics and restart action.
 */

import "../service-health.css";

import { ReactNode } from "react";

import { RuntimeServiceSnapshot } from "../types";

type Props = {
  service: RuntimeServiceSnapshot | null;
  canRestart: boolean;
  isRestarting: boolean;
  onClose: () => void;
  onRestart: () => void;
  children?: ReactNode;
};

const formatTimestamp = (value: string | null): string => {
  /* Raw ISO timestamps are noisy in the modal, so normalize them into one readable local string. */
  if (!value) {
    return "Unavailable";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const formatUptime = (seconds: number | null): string => {
  /* The modal can show a slightly richer uptime string than the compact cards. */
  if (seconds == null) {
    return "Unavailable";
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${seconds}s`;
};

export const ServiceHealthModal = (props: Props) => {
  /* Render nothing when no service card is selected so Settings layout stays simple. */
  if (!props.service) {
    return null;
  }

  const service = props.service;

  return (
    <div className="service-health-modal-backdrop" role="presentation" onClick={props.onClose}>
      <div
        className="service-health-modal"
        role="dialog"
        aria-modal="true"
        aria-label={service.label}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="service-health-modal-header">
          <div>
            <h4 className="service-health-modal-title">{service.label}</h4>
            <div className="service-health-caption">{service.containerName ?? "Container missing"}</div>
          </div>

          <button className="btn ghost" onClick={props.onClose} type="button">
            Close
          </button>
        </div>

        <div className="service-health-modal-grid">
          <div className="service-health-detail-card">
            <div className="service-health-detail-label">Health</div>
            <div className={`service-health-detail-value ${service.health}`}>{service.health}</div>
          </div>
          <div className="service-health-detail-card">
            <div className="service-health-detail-label">Container state</div>
            <div className="service-health-detail-value">{service.containerStatus}</div>
          </div>
          <div className="service-health-detail-card">
            <div className="service-health-detail-label">Uptime</div>
            <div className="service-health-detail-value">{formatUptime(service.uptimeSeconds)}</div>
          </div>
          <div className="service-health-detail-card">
            <div className="service-health-detail-label">Started</div>
            <div className="service-health-detail-value">{formatTimestamp(service.startedAt)}</div>
          </div>
        </div>

        <div className="service-health-message-box">{service.message}</div>

        <div className="service-health-modal-grid compact">
          <div className="service-health-detail-card">
            <div className="service-health-detail-label">Probe URL</div>
            <div className="service-health-detail-value small">{service.probeUrl ?? "Unavailable"}</div>
          </div>
          <div className="service-health-detail-card">
            <div className="service-health-detail-label">Probe status</div>
            <div className="service-health-detail-value small">
              {service.probe ? service.probe.statusCode ?? service.probe.errorCode ?? "Unavailable" : "Unavailable"}
            </div>
          </div>
          <div className="service-health-detail-card">
            <div className="service-health-detail-label">Probe latency</div>
            <div className="service-health-detail-value small">
              {service.probe?.latencyMs != null ? `${service.probe.latencyMs} ms` : "Unavailable"}
            </div>
          </div>
          <div className="service-health-detail-card">
            <div className="service-health-detail-label">Docker healthcheck</div>
            <div className="service-health-detail-value small">{service.healthcheckStatus ?? "Unavailable"}</div>
          </div>
        </div>

        <div className="service-health-modal-actions">
          <button className="btn outline" onClick={props.onClose} type="button">
            Close details
          </button>

          {/* Keep self-disrupting services read-only in Mini App so operators do not cut off their own control surface. */}
          {props.canRestart ? (
            <button className="btn primary" onClick={props.onRestart} disabled={props.isRestarting} type="button">
              {props.isRestarting ? "Restarting..." : "Restart service"}
            </button>
          ) : (
            <div className="project-create-note">Restart is intentionally unavailable from Mini App for this service.</div>
          )}
        </div>

        {props.children ? <div className="service-health-children">{props.children}</div> : null}
      </div>
    </div>
  );
};
