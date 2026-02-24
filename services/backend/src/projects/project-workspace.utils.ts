/**
 * @fileoverview Helpers for project folder creation/cloning workflows.
 *
 * Exports:
 * - normalizeProjectFolderName (L15) - Validates project folder name.
 * - deriveFolderNameFromRepositoryUrl (L26) - Extracts folder name from clone URL.
 * - isLikelyGitUrl (L42) - Basic validation for clone URL formats.
 */

const PROJECT_FOLDER_NAME_REGEX = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9-])?$/;
const HTTPS_GIT_URL_REGEX = /^https?:\/\/.+/i;
const SSH_GIT_URL_REGEX = /^git@[^:]+:[^\s]+$/i;
const MULTI_DASH_REGEX = /-+/g;
const EDGE_DASH_REGEX = /^[-._]+|[-._]+$/g;

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya"
};

const transliterateCyrillic = (value: string): string => {
  /* Keep slug generation deterministic for common Russian folder names. */
  return value
    .split("")
    .map((char) => CYRILLIC_TO_LATIN[char] ?? char)
    .join("");
};

export const normalizeProjectFolderName = (name: string): string => {
  /* Normalize arbitrary names into stable lowercase slug-like folder names. */
  if (name.includes("/") || name.includes("\\")) {
    throw new Error(`Invalid project folder name: ${name}`);
  }

  const trimmed = name.trim().toLowerCase();
  const transliterated = transliterateCyrillic(trimmed);
  const normalized = transliterated
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(MULTI_DASH_REGEX, "-")
    .replace(EDGE_DASH_REGEX, "");

  if (!PROJECT_FOLDER_NAME_REGEX.test(normalized)) {
    throw new Error(`Invalid project folder name: ${name}`);
  }
  return normalized;
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
