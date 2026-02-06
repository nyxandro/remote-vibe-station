/**
 * @fileoverview OpenCode project storage file format helpers.
 *
 * Exports:
 * - OpenCodeProjectRecord (L16) - Minimal project schema used by OpenCode.
 * - toOpenCodeProjectRecord (L31) - Creates a record from a folder path.
 */

export type OpenCodeProjectRecord = {
  id: string;
  worktree: string;
  sandboxes: unknown[];
  time: {
    created: number;
    updated: number;
  };
  /* Optional fields supported by OpenCode API. */
  name?: string;
  icon?: {
    color?: string;
    url?: string;
    override?: string;
  };
  commands?: { start?: string };
};

export const toOpenCodeProjectRecord = (input: {
  id: string;
  worktree: string;
  nowMs: number;
  name?: string;
}): OpenCodeProjectRecord => {
  /*
   * OpenCode currently lists projects by reading JSON files from storage/project.
   * We keep the payload minimal and compatible with API responses.
   */
  return {
    id: input.id,
    worktree: input.worktree,
    sandboxes: [],
    time: {
      created: input.nowMs,
      updated: input.nowMs
    },
    name: input.name
  };
};
