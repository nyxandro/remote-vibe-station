/**
 * @fileoverview Shared kanban value guards and text normalizers.
 *
 * Exports:
 * - requireKanbanTitle - Validates non-empty task titles.
 * - requireKanbanProjectSlug - Validates non-empty project slugs.
 * - requireKanbanAgentId - Validates non-empty agent identifiers.
 * - requireKanbanTaskId - Validates non-empty task identifiers.
 * - requireKanbanCriterionId - Validates non-empty criterion identifiers.
 * - requireKanbanCriterionStatus - Validates criterion status values.
 * - requireKanbanStatus - Validates task status values.
 * - normalizeOptionalKanbanStatus - Keeps nullable list filters explicit.
 * - requireKanbanPriority - Validates task priority values.
 * - normalizeOptionalKanbanLimit - Validates optional list limits.
 * - normalizeKanbanLeaseMs - Validates optional lease durations.
 * - normalizeKanbanText - Trims text fields.
 * - normalizeNullableKanbanText - Trims nullable text fields.
 */

import {
  KANBAN_CRITERION_STATUSES,
  KANBAN_PRIORITIES,
  KANBAN_STATUSES,
  KanbanCriterionStatus,
  KanbanPriority,
  KanbanStatus,
  UpdateKanbanCriterionInput
} from "./kanban.types";
import { KanbanValidationError } from "./kanban.errors";

const DEFAULT_CLAIM_LEASE_MS = 2 * 60 * 60 * 1000;

export const normalizeKanbanText = (value: string | null | undefined): string => {
  /* Shared trimming keeps every persisted text field stable across UI and agent writes. */
  return typeof value === "string" ? value.trim() : "";
};

export const normalizeNullableKanbanText = (value: string | null | undefined): string | null => {
  /* Nullable summaries and blocker notes should preserve absence instead of empty-string noise. */
  const normalized = normalizeKanbanText(value);
  return normalized.length > 0 ? normalized : null;
};

export const requireKanbanTitle = (value: string): string => {
  /* Task titles stay mandatory because humans and agents both rely on concise card names. */
  const normalized = normalizeKanbanText(value);
  if (!normalized) {
    throw new KanbanValidationError("Task title is required");
  }
  return normalized;
};

export const requireKanbanProjectSlug = (value: string): string => {
  /* Every card belongs to a concrete project, so empty project ids must fail fast. */
  const normalized = normalizeKanbanText(value);
  if (!normalized) {
    throw new KanbanValidationError("Project slug is required");
  }
  return normalized;
};

export const requireKanbanAgentId = (value: string): string => {
  /* Agent ids are stored on claims and ownership markers, so they cannot be implicit. */
  const normalized = normalizeKanbanText(value);
  if (!normalized) {
    throw new KanbanValidationError("Agent id is required");
  }
  return normalized;
};

export const requireKanbanTaskId = (value: string): string => {
  /* Task ids are opaque identifiers, so only presence validation should happen here. */
  const normalized = normalizeKanbanText(value);
  if (!normalized) {
    throw new KanbanValidationError("Task id is required");
  }
  return normalized;
};

export const requireKanbanCriterionId = (value: string): string => {
  /* Criterion ids must stay explicit so checklist updates remain deterministic across sessions. */
  const normalized = normalizeKanbanText(value);
  if (!normalized) {
    throw new KanbanValidationError("Criterion id is required");
  }
  return normalized;
};

export const requireKanbanCriterionStatus = (
  value: UpdateKanbanCriterionInput["status"]
): UpdateKanbanCriterionInput["status"] => {
  /* Criterion state is intentionally tiny so agents cannot invent hidden workflow sub-states. */
  if (!KANBAN_CRITERION_STATUSES.includes(value)) {
    throw new KanbanValidationError(`Unsupported kanban criterion status: ${value}`);
  }
  return value;
};

export const requireKanbanStatus = (value: KanbanStatus): KanbanStatus => {
  /* Reject unknown task states before they can corrupt queue ordering or runner decisions. */
  if (!KANBAN_STATUSES.includes(value)) {
    throw new KanbanValidationError(`Unsupported kanban status: ${value}`);
  }
  return value;
};

export const normalizeOptionalKanbanStatus = (value: KanbanStatus | null): KanbanStatus | null => {
  /* Nullable filters stay explicit so list endpoints can distinguish omitted vs invalid status. */
  return value == null ? null : requireKanbanStatus(value);
};

export const requireKanbanPriority = (value: KanbanPriority): KanbanPriority => {
  /* Priority drives queue ordering, so values are validated at the boundary. */
  if (!KANBAN_PRIORITIES.includes(value)) {
    throw new KanbanValidationError(`Unsupported kanban priority: ${value}`);
  }
  return value;
};

export const normalizeOptionalKanbanLimit = (value: number | undefined): number | null => {
  /* Optional list limits keep plugin responses bounded without accepting invalid sizes. */
  if (value == null) {
    return null;
  }
  if (!Number.isFinite(value) || value < 1) {
    throw new KanbanValidationError("limit must be a positive number");
  }
  return Math.floor(value);
};

export const normalizeKanbanLeaseMs = (value: number | undefined): number => {
  /* Shared lease validation keeps both runner and session claims bounded and recoverable. */
  if (value == null) {
    return DEFAULT_CLAIM_LEASE_MS;
  }
  if (!Number.isFinite(value) || value < 60_000) {
    throw new KanbanValidationError("leaseMs must be at least 60000");
  }
  return Math.floor(value);
};

export const isKanbanCriterionStatus = (value: string): value is KanbanCriterionStatus =>
  KANBAN_CRITERION_STATUSES.includes(value as KanbanCriterionStatus);

export const isKanbanPriority = (value: string): value is KanbanPriority =>
  KANBAN_PRIORITIES.includes(value as KanbanPriority);

export const isKanbanStatus = (value: string): value is KanbanStatus => KANBAN_STATUSES.includes(value as KanbanStatus);
