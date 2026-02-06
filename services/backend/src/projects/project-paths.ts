/**
 * @fileoverview Path validation utilities for project roots.
 *
 * Exports:
 * - assertWithinRoot (L10) - Ensure path is inside PROJECTS_ROOT.
 */

import * as path from "node:path";

export const assertWithinRoot = (root: string, target: string): void => {
  /* Resolve paths to absolute form. */
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);

  /* Enforce root containment. */
  const isRoot = resolvedTarget === resolvedRoot;
  const isChild = resolvedTarget.startsWith(resolvedRoot + path.sep);
  if (!isRoot && !isChild) {
    throw new Error(`Path is outside of projects root: ${resolvedTarget}`);
  }
};
