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
 * - GroqTranscriptionModel (L89) - Supported Groq speech-to-text models.
 * - VoiceControlSettings (L91) - Persisted Telegram voice-control settings.
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
  projectEnv: { exists: boolean; absolutePath: string } | null;
  projectEnvFiles: SettingsFileSummary[];
  config: { exists: boolean; absolutePath: string };
  agents: SettingsFileSummary[];
  commands: SettingsFileSummary[];
};

export type OpenCodeSettingsKind =
  | "globalRule"
  | "projectRule"
  | "projectEnv"
  | "projectEnvFile"
  | "config"
  | "agent"
  | "command";

export type GroqTranscriptionModel = "whisper-large-v3-turbo" | "whisper-large-v3";

export type VoiceControlSettings = {
  enabled: boolean;
  apiKey: string | null;
  model: GroqTranscriptionModel | null;
  supportedModels: GroqTranscriptionModel[];
};

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
