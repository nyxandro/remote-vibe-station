/**
 * @fileoverview Explicit error types for kanban validation and request shaping.
 *
 * Exports:
 * - KanbanValidationError - Marks client-fixable kanban input/state problems.
 */

export class KanbanValidationError extends Error {
  public constructor(message: string) {
    /* Preserve standard Error behavior while giving controllers a stable type discriminator. */
    super(message);
    this.name = "KanbanValidationError";
  }
}
