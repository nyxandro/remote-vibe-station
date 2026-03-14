/**
 * @fileoverview Types and DI token for app configuration.
 *
 * Exports:
 * - AppConfig (L9) - Validated configuration shape.
 * - ConfigToken (L21) - Injection token for config provider.
 */

export type AppConfig = {
  telegramBotToken: string;
  /** Shared secret required on bot->backend admin API calls. */
  botBackendAuthToken: string;
  /** Optional BotFather mini app short name used in t.me deep-links. */
  telegramMiniappShortName?: string;
  adminIds: number[];
  publicBaseUrl: string;
  publicDomain: string;
  projectsRoot: string;
  /** Host directory that backs OpenCode state volume (optional for read-only deployments). */
  opencodeDataDir?: string;
  /** Container-visible OpenCode config directory (rules, agents, skills, plugins, config). */
  opencodeConfigDir?: string;
  /** If true, backend syncs PROJECTS_ROOT into OpenCode storage on startup. */
  opencodeSyncOnStart: boolean;
  /** If true, backend warms OpenCode "Recent projects" on startup. */
  opencodeWarmRecentsOnStart: boolean;
  /** Max number of folders to warm on each run. */
  opencodeWarmRecentsLimit: number;
  /** Optional override for the default model used by OpenCode prompts. */
  opencodeDefaultProviderId?: string;
  opencodeDefaultModelId?: string;
  opencodeServerUrl: string;
  opencodeServerPassword?: string;
  opencodeServerUsername?: string;
  /** Enables background kanban automation runner. */
  kanbanRunnerEnabled: boolean;
  /** Optional CLIProxy management base URL for account onboarding APIs. */
  cliproxyManagementUrl?: string;
  /** Shared secret for CLIProxy management API header authentication. */
  cliproxyManagementPassword?: string;
  /** GitHub App ID used to mint short-lived installation tokens. */
  githubAppId?: string;
  /** GitHub App slug used to build installation URL. */
  githubAppSlug?: string;
  /** Base64-encoded PEM private key for GitHub App JWT signing. */
  githubAppPrivateKeyBase64?: string;
  /** Explicit opt-in for unauthenticated localhost browsing during isolated dev only. */
  allowUnsafeLocalAuth: boolean;
  eventBufferSize: number;
};

export const ConfigToken = Symbol("APP_CONFIG");
