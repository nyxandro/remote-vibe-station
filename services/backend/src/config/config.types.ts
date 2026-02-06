/**
 * @fileoverview Types and DI token for app configuration.
 *
 * Exports:
 * - AppConfig (L9) - Validated configuration shape.
 * - ConfigToken (L21) - Injection token for config provider.
 */

export type AppConfig = {
  telegramBotToken: string;
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
  eventBufferSize: number;
};

export const ConfigToken = Symbol("APP_CONFIG");
