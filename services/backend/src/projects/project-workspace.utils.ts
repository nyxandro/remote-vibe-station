/**
 * @fileoverview Helpers for project folder creation/cloning workflows.
 *
 * Exports:
 * - normalizeProjectFolderName (L15) - Validates project folder name.
 * - deriveFolderNameFromRepositoryUrl (L26) - Extracts folder name from clone URL.
 * - isLikelyGitUrl (L42) - Basic validation for clone URL formats.
 */

const PROJECT_FOLDER_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const HTTPS_GIT_URL_REGEX = /^https?:\/\/.+/i;
const SSH_GIT_URL_REGEX = /^git@[^:]+:[^\s]+$/i;

export const normalizeProjectFolderName = (name: string): string => {
  /* Keep folder names safe and filesystem-portable. */
  const trimmed = name.trim();
  if (!PROJECT_FOLDER_NAME_REGEX.test(trimmed)) {
    throw new Error(`Invalid project folder name: ${name}`);
  }
  return trimmed;
};

export const deriveFolderNameFromRepositoryUrl = (url: string): string => {
  /* Extract final path segment and strip optional .git suffix. */
  const cleaned = url.trim().replace(/\/$/, "");
  const segment = cleaned.split(/[/:]/).at(-1) ?? "";
  const withoutGit = segment.replace(/\.git$/i, "");
  return normalizeProjectFolderName(withoutGit);
};

export const isLikelyGitUrl = (value: string): boolean => {
  /* Accept the most common clone URL forms (HTTPS and SSH). */
  const trimmed = value.trim();
  return HTTPS_GIT_URL_REGEX.test(trimmed) || SSH_GIT_URL_REGEX.test(trimmed);
};
