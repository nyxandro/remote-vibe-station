/**
 * @fileoverview Collapsible task execution timeline for the kanban editor modal.
 *
 * Exports:
 * - KanbanTaskTimelineAccordion - Renders compact stage-by-stage timing derived from status transitions.
 */

import { Clock3, ChevronDown } from "lucide-react";

import { KanbanTask } from "../types";
import { buildKanbanExecutionTimeline, formatKanbanDuration } from "../utils/kanban-status-timeline";

type Props = {
  task: KanbanTask;
};

const formatTimelineTimestamp = (value: string): string => {
  /* Short local timestamps keep the timeline readable while still showing the order of stage changes. */
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
};

const formatStageDuration = (input: {
  status: KanbanTask["status"];
  durationMs: number;
  isActiveExecution: boolean;
  isPausedExecution: boolean;
}): string => {
  /* Stage badges emphasize whether time counted as active execution, paused time, or regular workflow dwell time. */
  if (input.status === "done" && input.durationMs === 0) {
    return "Completed";
  }

  const label = formatKanbanDuration(input.durationMs);
  if (input.isActiveExecution) {
    return `${label} active`;
  }
  if (input.isPausedExecution) {
    return `${label} paused`;
  }
  return label;
};

export const KanbanTaskTimelineAccordion = ({ task }: Props) => {
  const timeline = buildKanbanExecutionTimeline(task);

  return (
    <section className="kanban-form-section">
      <details className="kanban-timeline-accordion">
        <summary className="kanban-timeline-summary" aria-label="Execution timeline">
          <span className="kanban-timeline-summary-main">
            <span className="kanban-timeline-icon-wrap">
              <Clock3 size={16} />
            </span>
            <span className="kanban-timeline-summary-copy">
              <span className="kanban-timeline-summary-title">Execution timeline</span>
              <span className="kanban-timeline-summary-total">{formatKanbanDuration(timeline.totalActiveMs)}</span>
            </span>
          </span>
          <ChevronDown size={16} className="kanban-timeline-summary-chevron" />
        </summary>

        <div className="kanban-timeline-list" role="list">
          {timeline.items.map((item) => (
            <div
              key={`${item.status}:${item.changedAt}`}
              role="listitem"
              className={`kanban-timeline-item ${item.isActiveExecution ? "is-active" : ""} ${item.isPausedExecution ? "is-paused" : ""}`}
            >
              <div className="kanban-timeline-dot" aria-hidden="true" />
              <div className="kanban-timeline-item-body">
                <div className="kanban-timeline-item-header">
                  <span className="kanban-timeline-item-title">{item.label}</span>
                  <span className="kanban-timeline-item-duration">{formatStageDuration(item)}</span>
                </div>
                <div className="kanban-timeline-item-meta">
                  <span>{formatTimelineTimestamp(item.changedAt)}</span>
                  {item.isCurrent ? <span>Current stage</span> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
};
