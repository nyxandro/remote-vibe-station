/**
 * @fileoverview Compact board card for one kanban task.
 *
 * Exports:
 * - KanbanTaskCard - Renders the task title, compact metadata badges, and criterion progress strip.
 */

import { KanbanTask } from "../types";
import { buildKanbanExecutionTimeline, formatKanbanDuration } from "../utils/kanban-status-timeline";

type Props = {
  task: KanbanTask;
  scope: "project" | "global";
  priorityLabel: string;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
};

const getExecutionDurationLabel = (task: KanbanTask): string | null => {
  /* Board cards expose elapsed execution time only for completed tasks, where the number is final and stable. */
  if (task.status !== "done") {
    return null;
  }

  const executionTimeline = buildKanbanExecutionTimeline(task);
  return executionTimeline.totalActiveMs > 0 ? formatKanbanDuration(executionTimeline.totalActiveMs) : null;
};

const getCriterionClassName = (task: KanbanTask, criterionStatus: KanbanTask["acceptanceCriteria"][number]["status"]): string => {
  /* Criterion chips keep the same neon semantics as before, but stay isolated so the board component remains small. */
  if (criterionStatus === "blocked") {
    return "kanban-card-progress-segment kanban-card-progress-segment-blocked";
  }

  if (criterionStatus === "done") {
    return `kanban-card-progress-segment kanban-card-progress-segment-done kanban-card-progress-segment-done-${task.status}`;
  }

  return "kanban-card-progress-segment";
};

export const KanbanTaskCard = (props: Props) => {
  const executionDurationLabel = getExecutionDurationLabel(props.task);

  return (
    <article
      className={`kanban-card kanban-card-${props.task.status}`}
      draggable
      role="button"
      tabIndex={0}
      aria-label={`Open task ${props.task.title}`}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        /* Keyboard users need the same full-card edit affordance as pointer users. */
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        props.onOpen();
      }}
      onDragStart={props.onDragStart}
      onDragEnd={props.onDragEnd}
    >
      <div className="kanban-card-title">{props.task.title}</div>

      <div className="kanban-card-topline">
        <div className="kanban-card-topline-left">
          <span className={`kanban-priority-badge kanban-priority-${props.task.priority}`}>{props.priorityLabel}</span>

          {executionDurationLabel ? (
            <span className="kanban-duration-badge" aria-label={`Execution time ${executionDurationLabel}`}>
              {executionDurationLabel}
            </span>
          ) : null}

          {props.scope === "global" ? <span className="kanban-project-badge">{props.task.projectName}</span> : null}
        </div>
      </div>

      {props.task.acceptanceCriteria.length > 0 ? (
        <div className="kanban-card-progress">
          {props.task.acceptanceCriteria.map((criterion, index) => (
            <div
              key={criterion.id || index}
              className={getCriterionClassName(props.task, criterion.status)}
              title={criterion.text}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
};
