/**
 * @fileoverview Local draft persistence for the kanban task-creation modal.
 *
 * Exports:
 * - KanbanTaskEditorDraftStorageScope - Scope names used in draft storage keys.
 * - KanbanTaskEditorDraft - Persisted create-modal draft shape.
 * - readStoredKanbanTaskEditorDraft - Reads one saved draft for the selected scope/project.
 * - writeStoredKanbanTaskEditorDraft - Persists or removes one draft snapshot.
 * - clearStoredKanbanTaskEditorDraft - Removes one saved draft explicitly.
 */

import { KanbanCriterion, KanbanPriority, KanbanStatus } from "../types";

export type KanbanTaskEditorDraftStorageScope = "project" | "global";

export type KanbanTaskEditorDraft = {
  projectSlug: string;
  title: string;
  description: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  acceptanceCriteria: KanbanCriterion[];
  criterionDraft: string;
  resultSummary: string;
  blockedReason: string;
};

const STORAGE_KEY_PREFIX = "tvoc.kanban.createDraft";
const EMPTY_PROJECT_KEY = "__none__";
const VALID_KANBAN_STATUSES: KanbanStatus[] = ["backlog", "refinement", "ready", "queued", "in_progress", "blocked", "done"];
const VALID_KANBAN_PRIORITIES: KanbanPriority[] = ["low", "medium", "high"];

const buildDraftStorageKey = (input: { scope: KanbanTaskEditorDraftStorageScope; projectSlug: string }): string => {
  /* Project-aware keys keep drafts isolated so closing one modal never overwrites another project's unfinished task. */
  const normalizedProjectSlug = input.projectSlug.trim() || EMPTY_PROJECT_KEY;
  return `${STORAGE_KEY_PREFIX}.${input.scope}.${normalizedProjectSlug}`;
};

const isNonEmptyCriterion = (criterion: KanbanCriterion): boolean => {
  /* Persist only structurally valid checklist rows so broken storage never pollutes the editor state. */
  return typeof criterion.id === "string" && criterion.id.trim().length > 0 && typeof criterion.text === "string";
};

const isValidKanbanStatus = (value: unknown): value is KanbanStatus => {
  /* Corrupted storage must not inject unsupported workflow states into the editor. */
  return typeof value === "string" && VALID_KANBAN_STATUSES.includes(value as KanbanStatus);
};

const isValidKanbanPriority = (value: unknown): value is KanbanPriority => {
  /* Priority badges drive queue semantics, so draft recovery only accepts known values. */
  return typeof value === "string" && VALID_KANBAN_PRIORITIES.includes(value as KanbanPriority);
};

const isEmptyDraft = (draft: KanbanTaskEditorDraft): boolean => {
  /* Empty drafts are deleted instead of stored forever so localStorage stays small and predictable. */
  return (
    draft.title.trim().length === 0 &&
    draft.description.trim().length === 0 &&
    draft.acceptanceCriteria.length === 0 &&
    draft.criterionDraft.trim().length === 0 &&
    draft.resultSummary.trim().length === 0 &&
    draft.blockedReason.trim().length === 0 &&
    draft.status === "backlog" &&
    draft.priority === "medium"
  );
};

export const readStoredKanbanTaskEditorDraft = (input: {
  scope: KanbanTaskEditorDraftStorageScope;
  projectSlug: string;
}): KanbanTaskEditorDraft | null => {
  /* Invalid or missing storage entries should fail closed and simply behave like no saved draft exists. */
  const raw = localStorage.getItem(buildDraftStorageKey(input));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<KanbanTaskEditorDraft> | null;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const status = parsed.status;
    const priority = parsed.priority;
    const acceptanceCriteria = Array.isArray(parsed.acceptanceCriteria)
      ? parsed.acceptanceCriteria.filter(isNonEmptyCriterion)
      : [];

    if (!isValidKanbanStatus(status) || !isValidKanbanPriority(priority)) {
      return null;
    }

    return {
      projectSlug: typeof parsed.projectSlug === "string" ? parsed.projectSlug : input.projectSlug,
      title: typeof parsed.title === "string" ? parsed.title : "",
      description: typeof parsed.description === "string" ? parsed.description : "",
      status,
      priority,
      acceptanceCriteria,
      criterionDraft: typeof parsed.criterionDraft === "string" ? parsed.criterionDraft : "",
      resultSummary: typeof parsed.resultSummary === "string" ? parsed.resultSummary : "",
      blockedReason: typeof parsed.blockedReason === "string" ? parsed.blockedReason : ""
    };
  } catch {
    return null;
  }
};

export const writeStoredKanbanTaskEditorDraft = (input: {
  scope: KanbanTaskEditorDraftStorageScope;
  projectSlug: string;
  draft: KanbanTaskEditorDraft;
}): void => {
  /* Persist the in-progress form per project, but drop empty snapshots instead of keeping noisy placeholders. */
  const key = buildDraftStorageKey(input);
  try {
    if (isEmptyDraft(input.draft)) {
      localStorage.removeItem(key);
      return;
    }

    localStorage.setItem(key, JSON.stringify(input.draft));
  } catch (error) {
    /* Draft persistence is best-effort only; storage quota issues must not break the task editor itself. */
    console.error("Failed to persist kanban task draft", {
      scope: input.scope,
      projectSlug: input.projectSlug,
      error
    });
  }
};

export const clearStoredKanbanTaskEditorDraft = (input: {
  scope: KanbanTaskEditorDraftStorageScope;
  projectSlug: string;
}): void => {
  /* Successful task creation clears only the corresponding project draft so unrelated drafts survive. */
  localStorage.removeItem(buildDraftStorageKey(input));
};
