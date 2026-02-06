/**
 * @fileoverview Containers tab UI.
 *
 * Exports:
 * - ContainersTab (L19) - Renders compose controls, container rows, and logs.
 */

import { ContainerAction, ProjectStatus } from "../types";
import { Play, RotateCw, Square } from "lucide-react";

type Props = {
  activeId: string | null;
  status: ProjectStatus[] | undefined;
  logs: string | undefined;
  onRunComposeAction: (action: ContainerAction) => void;
  onRunContainerAction: (service: string, action: ContainerAction) => void;
  onLoadLogs: () => void;
};

export const ContainersTab = (props: Props) => {
  /* Render compose controls, container cards, and optional logs. */
  const hasLogs = props.logs !== undefined && props.logs !== null;
  const hasStatusRows = Boolean(props.activeId && props.status && props.status.length > 0);
  const canControl = Boolean(props.activeId);

  const renderActionButton = (label: string, action: ContainerAction) => {
    /* Reusable compose-level action button to keep labels consistent. */
    const Icon =
      action === "start" ? Play : action === "restart" ? RotateCw : Square;

    return (
      <button
        className="icon-action-btn icon-action-btn-compose"
        disabled={!canControl}
        onClick={() => props.onRunComposeAction(action)}
        aria-label={label}
        title={label}
        type="button"
      >
        <Icon size={15} />
      </button>
    );
  };

  return (
    <>
      <div className="panel-title">Containers</div>

      <div className="compose-controls">
        <span className="compose-controls-label">Compose Controls</span>
        <div className="compose-controls-actions">
          {renderActionButton("Start All", "start")}
          {renderActionButton("Restart All", "restart")}
          {renderActionButton("Stop All", "stop")}
        </div>
      </div>

      <div className="container-list">
        {hasStatusRows
          ? props.status?.map((container) => (
              <article key={container.name} className="container-row">
                <div className="container-row-line container-row-title">{container.name}</div>
                <div className="container-row-line container-row-state">{container.state}</div>
                <div className="container-row-line container-row-ports">
                  {(container.ports ?? []).join(", ") || "No published ports"}
                </div>

                <div className="container-row-actions">
                  <button
                    className="icon-action-btn"
                    disabled={!container.service}
                    onClick={() => props.onRunContainerAction(container.service, "start")}
                    aria-label={`Start ${container.service}`}
                    title="Start"
                    type="button"
                  >
                    <Play size={14} />
                  </button>
                  <button
                    className="icon-action-btn"
                    disabled={!container.service}
                    onClick={() => props.onRunContainerAction(container.service, "restart")}
                    aria-label={`Restart ${container.service}`}
                    title="Restart"
                    type="button"
                  >
                    <RotateCw size={14} />
                  </button>
                  <button
                    className="icon-action-btn icon-action-btn-stop"
                    disabled={!container.service}
                    onClick={() => props.onRunContainerAction(container.service, "stop")}
                    aria-label={`Stop ${container.service}`}
                    title="Stop"
                    type="button"
                  >
                    <Square size={13} />
                  </button>
                </div>
              </article>
            ))
          : "Container status updates automatically after project selection."}
      </div>

      <div className="panel-spacer" />
      <div className="container-logs-toolbar">
        <button className="btn outline" disabled={!canControl} onClick={props.onLoadLogs} type="button">
          Load Logs
        </button>
      </div>
      {props.activeId && hasLogs ? <pre className="log-box">{props.logs}</pre> : "Click Load Logs to fetch output."}
    </>
  );
};
