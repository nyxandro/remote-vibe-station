/**
 * @fileoverview Helpers for normalizing, migrating, and validating kanban acceptance criteria.
 *
 * Exports:
 * - normalizeCriterionInputs - Converts UI/agent criterion payloads into persisted checklist records.
 * - normalizeStoredCriteria - Migrates legacy stored criteria into structured checklist records.
 * - countDoneCriteria - Counts satisfied criteria for summaries and automation checks.
 * - areAllCriteriaDone - Verifies task completion readiness.
 * - hasBlockedCriteria - Detects criterion-level blockers that must stop the whole task.
 */

import * as crypto from "node:crypto";

import {
  KANBAN_CRITERION_STATUSES,
  KanbanCriterionInput,
  KanbanCriterionRecord,
  KanbanCriterionStatus
} from "./kanban.types";

const DEFAULT_CRITERION_STATUS: KanbanCriterionStatus = "pending";

const normalizeCriterionText = (value: unknown): string => {
  /* Criteria are persisted as concise checklist items, so surrounding whitespace is never meaningful. */
  return typeof value === "string" ? value.trim() : "";
};

const normalizeOptionalCriterionId = (value: unknown): string | null => {
  /* Keep ids explicit when provided, but treat blank values as missing so the caller can mint a new one. */
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
};

const normalizeOptionalCriterionStatus = (value: unknown): KanbanCriterionStatus | null => {
  /* Unknown states must be ignored at this layer so callers can decide whether to fail or default. */
  return typeof value === "string" && KANBAN_CRITERION_STATUSES.includes(value as KanbanCriterionStatus)
    ? (value as KanbanCriterionStatus)
    : null;
};

const normalizeOptionalBlockedReason = (value: unknown): string | null => {
  /* Blocked criteria can carry a reason, but empty strings should not persist as meaningful data. */
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
};

const createLegacyCriterionId = (input: { index: number; text: string }): string => {
  /* Deterministic ids let old JSON stores upgrade without churn before the first rewrite. */
  const digest = crypto
    .createHash("sha1")
    .update(`${input.index}:${input.text}`)
    .digest("hex")
    .slice(0, 10);
  return `legacy-${input.index + 1}-${digest}`;
};

const asCriterionObject = (value: unknown): { id?: unknown; text?: unknown; status?: unknown; blockedReason?: unknown } | null => {
  /* Unknown store/UI payloads are narrowed once so the rest of the module can stay type-safe and terse. */
  return typeof value === "object" && value ? (value as { id?: unknown; text?: unknown; status?: unknown }) : null;
};

export const normalizeCriterionInputs = (
  input: KanbanCriterionInput[] | undefined,
  options?: {
    existingCriteria?: KanbanCriterionRecord[];
    createId?: () => string;
  }
): KanbanCriterionRecord[] => {
  /* Preserve stable ids/statuses when callers resubmit existing rows, while minting ids for new checklist items. */
  if (!Array.isArray(input)) {
    return [];
  }

  const existingById = new Map((options?.existingCriteria ?? []).map((criterion) => [criterion.id, criterion]));
  const createId = options?.createId ?? (() => crypto.randomUUID());
  const usedIds = new Set<string>();

  return input.reduce<KanbanCriterionRecord[]>((result, item) => {
    const criterionObject = asCriterionObject(item);
    const rawText = typeof item === "string" ? item : criterionObject?.text;
    const text = normalizeCriterionText(rawText);
    if (!text) {
      return result;
    }

    const requestedId = criterionObject ? normalizeOptionalCriterionId(criterionObject.id) : null;
    const existing = requestedId ? existingById.get(requestedId) ?? null : null;
    const requestedStatus = criterionObject ? normalizeOptionalCriterionStatus(criterionObject.status) : null;
    let nextId = requestedId ?? existing?.id ?? createId();
    const nextStatus = requestedStatus ?? existing?.status ?? DEFAULT_CRITERION_STATUS;
    const requestedBlockedReason = criterionObject ? normalizeOptionalBlockedReason(criterionObject.blockedReason) : null;

    if (usedIds.has(nextId)) {
      nextId = createId();
    }

    usedIds.add(nextId);
    result.push({
      id: nextId,
      text,
      status: nextStatus,
      blockedReason: nextStatus === "blocked" ? requestedBlockedReason ?? existing?.blockedReason ?? null : null
    });
    return result;
  }, []);
};

export const normalizeStoredCriteria = (input: unknown): KanbanCriterionRecord[] => {
  /* Store reads accept both legacy string arrays and the new structured checklist records. */
  if (!Array.isArray(input)) {
    return [];
  }

  return input.reduce<KanbanCriterionRecord[]>((result, item, index) => {
    const criterionObject = asCriterionObject(item);
    const text = normalizeCriterionText(typeof item === "string" ? item : criterionObject?.text);
    if (!text) {
      return result;
    }

    result.push({
      id:
        (criterionObject ? normalizeOptionalCriterionId(criterionObject.id) : null) ??
        createLegacyCriterionId({ index, text }),
      text,
      status:
        (criterionObject ? normalizeOptionalCriterionStatus(criterionObject.status) : null) ??
        DEFAULT_CRITERION_STATUS,
      blockedReason: criterionObject ? normalizeOptionalBlockedReason(criterionObject.blockedReason) : null
    });
    return result;
  }, []);
};

export const countDoneCriteria = (criteria: KanbanCriterionRecord[]): number => {
  /* One shared counter keeps UI summaries and completion checks consistent. */
  return criteria.filter((criterion) => criterion.status === "done").length;
};

export const areAllCriteriaDone = (criteria: KanbanCriterionRecord[]): boolean => {
  /* Empty criteria arrays are allowed for backlog grooming, so completion remains vacuously true there. */
  return criteria.every((criterion) => criterion.status === "done");
};

export const hasBlockedCriteria = (criteria: KanbanCriterionRecord[]): boolean => {
  /* Any blocked criterion means the task cannot continue autonomously and must surface as blocked. */
  return criteria.some((criterion) => criterion.status === "blocked");
};
