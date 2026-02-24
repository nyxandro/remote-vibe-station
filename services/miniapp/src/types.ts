/**
 * @fileoverview Shared types for Mini App.
 *
 * Exports:
 * - ProjectRecord (L17) - Project data from backend.
 * - ProjectStatus (L30) - Container status response.
 * - ProjectGitSummary (L39) - Uncommitted git change counters.
 * - GitOverview (L59) - Branch and changed files overview for GitHub tab.
 * - OpenCodeSettingsOverview (L72) - Accordion metadata for settings files.
 * - GroqTranscriptionModel (L91) - Supported Groq speech-to-text models.
 * - VoiceControlSettings (L93) - Persisted Telegram voice-control settings.
 * - ProviderAuthMethod (L99) - Available connect methods per provider.
 * - ProviderOverview (L104) - Providers tab payload from backend.
 * - OpenCodeVersionStatus (L124) - Current/latest OpenCode version metadata.
 * - OpenCodeVersionUpdateResult (L131) - Result payload for OpenCode update operation.
 * - DiffPreviewResponse (L159) - Token-based diff preview payload.
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

export type ProjectRuntimeMode = "docker" | "static";

export type ProjectRuntimeSnapshot = {
  slug: string;
  mode: ProjectRuntimeMode;
  serviceName: string | null;
  internalPort: number | null;
  staticRoot: string | null;
  availableServices: string[];
  previewUrl: string;
  deployed: boolean;
};

export type ProjectRuntimeSettingsPatch = {
  mode?: ProjectRuntimeMode;
  serviceName?: string | null;
  internalPort?: number | null;
  staticRoot?: string | null;
};

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

export type ProviderAuthMethod = {
  type: "oauth" | "api";
  label: string;
};

export type ProviderOverview = {
  selected: {
    model: {
      providerID: string;
      modelID: string;
    };
    thinking: string | null;
    agent: string | null;
  };
  providers: Array<{
    id: string;
    name: string;
    connected: boolean;
    defaultModelID?: string;
  }>;
  authMethods: Record<string, ProviderAuthMethod[]>;
};

export type OpenCodeVersionStatus = {
  currentVersion: string;
  latestVersion: string | null;
  latestCheckedAt: string | null;
  updateAvailable: boolean;
};

export type OpenCodeVersionUpdateResult = {
  updated: boolean;
  restarted: string[];
  before: OpenCodeVersionStatus;
  after: OpenCodeVersionStatus;
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
