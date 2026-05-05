/**
 * @fileoverview Shared types for Mini App.
 *
 * Exports:
 * - ProjectRecord - Project data from backend.
 * - ProjectStatus (L30) - Container status response.
 * - ProjectGitSummary - Compact active-branch and local change counters.
 * - GitOverview - Branch and changed files overview for GitHub tab.
 * - OpenCodeSettingsOverview (L72) - Accordion metadata for settings files.
 * - SkillCatalogFilter - Filter mode for NeuralDeep skill catalog results.
 * - NeuralDeepSkillCatalogItem - Remote skill catalog row enriched with local install state.
 * - InstalledOpenCodeSkill - Locally installed OpenCode skill summary.
 * - GroqTranscriptionModel (L91) - Supported Groq speech-to-text models.
 * - VoiceControlSettings (L93) - Persisted Telegram voice-control settings.
 * - GithubAuthStatus - Global GitHub PAT status used for agent git operations.
 * - ProviderAuthMethod (L99) - Available connect methods per provider.
 * - ProviderOverview (L104) - Providers tab payload from backend.
 * - SystemMetricsSnapshot - CPU/RAM/disk/network snapshot for Settings diagnostics.
 * - ProxySettingsSnapshot - CLI/Proxy profile and env preview payload.
 * - ProxyApplyResult - Result of runtime apply action from CLI/Proxy tab.
 * - CliproxyProviderState - One provider status inside CLIProxy account section.
 * - CliproxyAccountState - Full CLIProxy account state payload.
 * - CliproxyOAuthStartPayload - OAuth start response with browser URL and state.
 * - OpenCodeVersionStatus (L124) - Current/latest OpenCode version metadata.
 * - OpenCodeVersionUpdateResult (L131) - Result payload for OpenCode update operation.
 * - ManagedRuntimeServiceId - Supported runtime services shown in server health dashboard.
 * - RuntimeServicesSnapshot - Health snapshot for Mini App server service dashboard.
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

export type KanbanStatus = "backlog" | "refinement" | "ready" | "queued" | "in_progress" | "blocked" | "done";

export type KanbanPriority = "low" | "medium" | "high";

export type KanbanCriterionStatus = "pending" | "done" | "blocked";

export type KanbanCriterion = {
  id: string;
  text: string;
  status: KanbanCriterionStatus;
};

export type KanbanTaskStatusTimelineEntry = {
  status: KanbanStatus;
  changedAt: string;
};

export type KanbanTask = {
  id: string;
  projectSlug: string;
  projectName: string;
  title: string;
  description: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  acceptanceCriteria: KanbanCriterion[];
  resultSummary: string | null;
  blockedReason: string | null;
  createdAt: string;
  updatedAt: string;
  claimedBy: string | null;
  leaseUntil: string | null;
  executionSource?: "session" | "runner" | null;
  executionSessionId?: string | null;
  statusTimeline?: KanbanTaskStatusTimelineEntry[];
};

export type ProjectStatus = {
  name: string;
  service: string;
  state: string;
  ports?: string[];
};

export type ContainerAction = "start" | "restart" | "stop";

export type ProjectGitSummary = {
  currentBranch?: string;
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

export type SkillCatalogFilter = "all" | "installed" | "available";

export type NeuralDeepSkillCatalogItem = {
  id: string;
  name: string;
  owner: string | null;
  repo: string | null;
  description: string | null;
  installs: number | null;
  trending24h: number | null;
  category: string | null;
  tags: string[];
  featured: boolean;
  githubStars: number | null;
  type: string | null;
  installed: boolean;
};

export type InstalledOpenCodeSkill = {
  name: string;
  relativePath: string;
};

export type GroqTranscriptionModel = "whisper-large-v3-turbo" | "whisper-large-v3";

export type VoiceControlSettings = {
  enabled: boolean;
  hasApiKey: boolean;
  model: GroqTranscriptionModel | null;
  supportedModels: GroqTranscriptionModel[];
};

export type GithubAuthStatus = {
  configured: boolean;
  connected: boolean;
  tokenPreview?: string;
  updatedAt?: string;
  gitCredential: {
    connected: boolean;
    mode: "pat";
    updatedAt?: string;
  };
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

export type SystemMetricsSnapshot = {
  capturedAt: string;
  cpu: {
    cores: number;
    load1: number;
    load5: number;
    load15: number;
  };
  memory: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    freePercent: number;
    usedPercent: number;
  };
  disk: {
    rootPath: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    freePercent: number;
    usedPercent: number;
  };
  network: {
    interfaces: number;
    rxBytes: number;
    txBytes: number;
  };
};

export type ProxySettingsMode = "direct" | "vless";

export type ProxyEnabledService = "bot" | "opencode" | "cliproxy";

export type ProxySettingsInput = {
  mode: ProxySettingsMode;
  vlessProxyUrl: string | null;
  vlessConfigUrl: string | null;
  enabledServices: ProxyEnabledService[];
};

export type ProxySettingsTestInput = {
  vlessConfigUrl: string;
};

export type ProxySettingsTestResult = {
  ok: true;
  vlessProxyUrl: string;
  summary: string;
};

export type ProxySettingsSnapshot = ProxySettingsInput & {
  updatedAt: string;
  envPreview: {
    HTTP_PROXY: string | null;
    HTTPS_PROXY: string | null;
    ALL_PROXY: string | null;
    NO_PROXY: string;
  };
  runtimeFiles: {
    runtimeConfigDir: string | null;
    proxyEnvPath: string | null;
    overridePath: string | null;
    xrayConfigPath: string | null;
    recommendedApplyCommand: string | null;
  };
};

export type ProxyApplyResult = {
  ok: true;
  command: string;
  stdout: string;
  stderr: string;
};

export type CliproxyProviderState = {
  id: "codex" | "anthropic" | "antigravity" | "kimi" | "qwen" | "iflow";
  label: string;
  connected: boolean;
};

export type CliproxyAccountState = {
  usageTrackingEnabled: boolean;
  providers: CliproxyProviderState[];
  accounts: Array<{
    id: string;
    provider: CliproxyProviderState["id"];
    providerLabel: string;
    name: string;
    email: string | null;
    account: string | null;
    label: string | null;
    disabled: boolean;
    unavailable: boolean;
    canManage: boolean;
    status: string | null;
    statusMessage: string | null;
    quota: {
      mode: "live";
      planType: string | null;
      windows: Array<{
        id: string;
        label: string;
        remainingPercent: number;
        resetAt: string | null;
        resetAfterSeconds: number | null;
      }>;
    } | null;
    usage: {
      requestCount: number;
      tokenCount: number;
      failedRequestCount: number;
      models: string[];
      lastUsedAt: string | null;
    };
  }>;
};

export type CliproxyOAuthStartPayload = {
  provider: CliproxyProviderState["id"];
  state: string;
  url: string;
  instructions: string;
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

export type ManagedRuntimeServiceId = "miniapp" | "bot" | "opencode" | "cliproxy";

export type ManagedRuntimeServiceHealth = "healthy" | "degraded" | "down";

export type RuntimeServiceProbe = {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  errorCode: string | null;
};

export type RuntimeServiceSnapshot = {
  id: ManagedRuntimeServiceId;
  label: string;
  composeService: ManagedRuntimeServiceId;
  containerName: string | null;
  containerStatus: string;
  health: ManagedRuntimeServiceHealth;
  healthcheckStatus: string | null;
  startedAt: string | null;
  uptimeSeconds: number | null;
  probeUrl: string | null;
  probe: RuntimeServiceProbe | null;
  message: string;
  actions: {
    canRestart: boolean;
  };
};

export type RuntimeServicesSnapshot = {
  capturedAt: string;
  services: RuntimeServiceSnapshot[];
};

export type RuntimeVersionSnapshot = {
  runtimeConfigDir: string;
  currentVersion: string;
  currentImageTag: string;
  currentCommitSha: string | null;
  latestVersion: string | null;
  latestImageTag: string | null;
  latestReleaseNotes: string | null;
  latestCheckedAt: string | null;
  updateAvailable: boolean;
  images: {
    backend: string;
    miniapp: string;
    bot: string;
    opencode: string;
  };
  rollbackAvailable: boolean;
};

export type RuntimeUpdateState = {
  status: "idle" | "checking" | "available" | "updating" | "restarting" | "completed" | "failed";
  currentVersion: string | null;
  targetVersion: string | null;
  targetImageTag: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  error: string | null;
  steps: Array<{
    id: "checking" | "pulling" | "switching" | "restarting" | "verifying";
    label: string;
    status: "pending" | "running" | "completed" | "failed";
  }>;
};

export type RuntimeUpdateResult = {
  applied: boolean;
  previous: RuntimeVersionSnapshot;
  current: RuntimeVersionSnapshot;
};

export type FileEntry = {
  name: string;
  kind: "file" | "dir";
  sizeBytes?: number;
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
