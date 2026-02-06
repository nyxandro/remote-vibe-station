/**
 * @fileoverview Shared types for Mini App.
 *
 * Exports:
 * - ProjectRecord (L9) - Project data from backend.
 * - ProjectStatus (L18) - Container status response.
 * - ProjectGitSummary (L32) - Uncommitted git change counters.
 * - GitOverview (L41) - Branch and changed files overview for GitHub tab.
 * - OpenCodeSettingsOverview (L57) - Accordion metadata for settings files.
 * - DiffPreviewResponse (L44) - Token-based diff preview payload.
 */

export type ProjectRecord = {
  id: string;
  name: string;
  slug: string;
  rootPath: string;
  hasCompose: boolean;
  configured: boolean;
  runnable: boolean;
  status: "running" | "stopped" | "unknown";
  domain?: string;
  lastStartedAt?: string;
};

export type ProjectStatus = {
  name: string;
  service: string;
  state: string;
  ports?: string[];
};

export type ContainerAction = "start" | "restart" | "stop";

export type ProjectGitSummary = {
  filesChanged: number;
  additions: number;
  deletions: number;
};

export type GitFileStatus =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflict";

export type GitFileEntry = {
  path: string;
  status: GitFileStatus;
  additions: number;
  deletions: number;
};

export type GitOverview = {
  currentBranch: string;
  branches: string[];
  ahead: number;
  behind: number;
  files: GitFileEntry[];
};

export type SettingsFileSummary = {
  name: string;
  relativePath: string;
};

export type OpenCodeSettingsOverview = {
  globalRule: { exists: boolean; absolutePath: string };
  projectRule: { exists: boolean; absolutePath: string } | null;
  config: { exists: boolean; absolutePath: string };
  agents: SettingsFileSummary[];
  commands: SettingsFileSummary[];
  skills: SettingsFileSummary[];
  plugins: SettingsFileSummary[];
};

export type OpenCodeSettingsKind =
  | "globalRule"
  | "projectRule"
  | "config"
  | "agent"
  | "command"
  | "skill"
  | "plugin";

export type FileEntry = {
  name: string;
  kind: "file" | "dir";
};

export type FileListResponse = {
  rootPath: string;
  path: string;
  entries: FileEntry[];
};

export type FileReadResponse = {
  path: string;
  content: string;
};

export type DiffPreviewResponse = {
  token: string;
  operation: "create" | "edit" | "delete";
  absolutePath: string;
  additions: number;
  deletions: number;
  diff: string;
  before: string | null;
  after: string | null;
  createdAt: string;
};
