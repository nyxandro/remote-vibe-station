/**
 * @fileoverview Types for project registry and API.
 *
 * Exports:
 * - ProjectRecord (L9) - Stored project metadata.
 * - ProjectCreateRequest (L22) - Input for project registration.
 * - ProjectListItem (L31) - UI-friendly discovered project item.
 * - ProjectGitSummary (L54) - Uncommitted git changes summary.
 * - ProjectGitOverview (L66) - Branch, upstream, and file-level git overview.
 */

export type ProjectRecord = {
  id: string;
  name: string;
  slug: string;
  rootPath: string;
  composePath: string;
  serviceName: string;
  servicePort: number;
  domain: string;
  status: "running" | "stopped" | "unknown";
  lastStartedAt?: string;
};

export type ProjectCreateRequest = {
  name: string;
  slug: string;
  rootPath: string;
  composePath: string;
  serviceName: string;
  servicePort: number;
};

export type ProjectListItem = {
  /** Stable identifier used by UI routes; equals slug. */
  id: string;
  /** Folder-friendly project key. */
  slug: string;
  /** Display name (defaults to slug). */
  name: string;
  /** Absolute path to project folder. */
  rootPath: string;
  /** Whether a docker compose file is present at the root. */
  hasCompose: boolean;
  /** Whether project has explicit config (opencode.project.json). */
  configured: boolean;
  /** Whether backend can run lifecycle actions (start/stop/status/logs). */
  runnable: boolean;
  /** Last known runtime status (best-effort). */
  status: "running" | "stopped" | "unknown";
  /** Optional routing domain (prod mode). */
  domain?: string;
  lastStartedAt?: string;
};

export type ProjectGitSummary = {
  filesChanged: number;
  additions: number;
  deletions: number;
};

export type ProjectGitFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflict";

export type ProjectGitFileEntry = {
  path: string;
  status: ProjectGitFileStatus;
  additions: number;
  deletions: number;
};

export type ProjectGitOverview = {
  currentBranch: string;
  branches: string[];
  ahead: number;
  behind: number;
  files: ProjectGitFileEntry[];
};
