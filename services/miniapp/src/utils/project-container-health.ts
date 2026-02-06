/**
 * @fileoverview Helpers for rendering per-project container health summary.
 *
 * Exports:
 * - ProjectContainerHealth (L10) - Compact health descriptor for project cards.
 * - deriveProjectContainerHealth (L22) - Aggregates running/total containers for UI badge.
 */

import { ProjectStatus } from "../types";

export type ProjectContainerHealth = {
  runningCount: number;
  totalCount: number;
  countLabel: string;
  level: "healthy" | "partial" | "down";
};

const isRunningState = (state: string | undefined): boolean => {
  /* Docker state can be `running` or verbose `Up ...`; both mean live container. */
  const normalized = String(state ?? "").toLowerCase();
  return normalized.includes("running") || normalized.includes("up");
};

export const deriveProjectContainerHealth = (
  statusRows: ProjectStatus[] | undefined
): ProjectContainerHealth | null => {
  /* If compose is not up or status was not requested yet, hide health indicator. */
  if (!statusRows || statusRows.length === 0) {
    return null;
  }

  const totalCount = statusRows.length;
  const runningCount = statusRows.filter((row) => isRunningState(row.state)).length;
  const countLabel = runningCount === totalCount ? String(totalCount) : `${runningCount}/${totalCount}`;

  if (runningCount === totalCount) {
    return { runningCount, totalCount, countLabel, level: "healthy" };
  }
  if (runningCount > 0) {
    return { runningCount, totalCount, countLabel, level: "partial" };
  }
  return { runningCount, totalCount, countLabel, level: "down" };
};
