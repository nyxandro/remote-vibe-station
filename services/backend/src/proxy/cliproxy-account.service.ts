/**
 * @fileoverview Domain service for CLIProxy account onboarding and status.
 *
 * Exports:
 * - CliproxyAccountState - UI payload with provider statuses.
 * - CliproxyOAuthStartInput - Provider selection payload.
 * - CliproxyOAuthCompleteInput - Callback/code payload.
 * - CliproxyAccountService - Builds statuses and proxies OAuth start/callback calls.
 */

import { BadRequestException, Injectable, Logger } from "@nestjs/common";

import { CliproxyAuthRuntimeService } from "./cliproxy-auth-runtime.service";
import { CliproxyAuthFile, CliproxyManagementClient, CliproxyProviderId, CliproxyUsageDetail } from "./cliproxy-management.client";

const PROVIDER_DEFINITIONS: Array<{ id: CliproxyProviderId; label: string }> = [
  { id: "codex", label: "Codex" },
  { id: "anthropic", label: "Claude" },
  { id: "antigravity", label: "Antigravity" },
  { id: "kimi", label: "Kimi" },
  { id: "qwen", label: "Qwen" },
  { id: "iflow", label: "iFlow" }
];

const PROVIDER_FILE_MARKERS: Record<CliproxyProviderId, string[]> = {
  codex: ["codex"],
  anthropic: ["claude", "anthropic"],
  antigravity: ["antigravity"],
  kimi: ["kimi"],
  qwen: ["qwen"],
  iflow: ["iflow"]
};

type ProviderState = {
  id: CliproxyProviderId;
  label: string;
  connected: boolean;
};

type CliproxyConnectedAccount = {
  id: string;
  provider: CliproxyProviderId;
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
  usage: {
    requestCount: number;
    tokenCount: number;
    failedRequestCount: number;
    models: string[];
    lastUsedAt: string | null;
  };
};

export type CliproxyAccountState = {
  usageTrackingEnabled: boolean;
  providers: ProviderState[];
  accounts: CliproxyConnectedAccount[];
};

export type CliproxyOAuthStartInput = {
  provider: CliproxyProviderId;
};

export type CliproxyOAuthCompleteInput = {
  provider: CliproxyProviderId;
  callbackUrl?: string;
  code?: string;
  state?: string;
  error?: string;
};

@Injectable()
export class CliproxyAccountService {
  private readonly logger = new Logger(CliproxyAccountService.name);

  public constructor(
    private readonly api: CliproxyManagementClient,
    private readonly runtime: CliproxyAuthRuntimeService
  ) {}

  public async getState(): Promise<CliproxyAccountState> {
    /* State merges oauth auth-files, static API-key config, and observed usage into one provider view. */
    const [authFiles, config, usageTrackingEnabled, usageDetails] = await Promise.all([
      this.api.getAuthFiles(),
      this.api.getConfig(),
      this.api.getUsageStatisticsEnabled(),
      this.api.getUsage()
    ]);
    const loweredAuthFiles = authFiles.map((item) => item.name.toLowerCase());
    const accounts = this.buildConnectedAccounts(authFiles, usageDetails);

    const providers = PROVIDER_DEFINITIONS.map((provider) => {
      const hasOauthFile = PROVIDER_FILE_MARKERS[provider.id].some((marker) =>
        loweredAuthFiles.some((file) => file.includes(marker))
      );
      const hasApiKey = this.hasProviderApiKey(provider.id, config);
      return {
        id: provider.id,
        label: provider.label,
        connected: hasOauthFile || hasApiKey
      };
    });

    return {
      usageTrackingEnabled,
      providers,
      accounts
    };
  }

  public async startOAuth(input: CliproxyOAuthStartInput) {
    /* OAuth start endpoint returns URL+state the user opens in a browser. */
    this.assertProvider(input.provider);
    const payload = await this.api.startOAuth(input.provider);
    return {
      ...payload,
      instructions:
        "Откройте URL в браузере, завершите вход и вставьте сюда URL callback или отдельно code/state"
    };
  }

  public async completeOAuth(input: CliproxyOAuthCompleteInput): Promise<void> {
    /* Callback payload supports direct code/state fields or full callback URL pasted by user. */
    this.assertProvider(input.provider);

    const parsedFromUrl = input.callbackUrl ? this.parseCallbackUrl(input.callbackUrl) : null;
    const state = (input.state ?? parsedFromUrl?.state ?? "").trim();
    const code = (input.code ?? parsedFromUrl?.code ?? "").trim();
    const error = (input.error ?? parsedFromUrl?.error ?? "").trim();

    if (!state) {
      throw new BadRequestException("state is required");
    }
    if (!code && !error) {
      throw new BadRequestException("code or error is required");
    }

    await this.api.completeOAuth({
      provider: input.provider,
      state,
      code: code || undefined,
      error: error || undefined
    });
  }

  public async activateAccount(input: { accountId: string }): Promise<void> {
    /* Manual switch keeps only one enabled auth file per provider so operators can pin traffic explicitly. */
    const authFiles = await this.api.getAuthFiles();
    const target = this.requireManageableAuthFile(authFiles, input.accountId);
    const targetProvider = this.resolveProviderFromAuthFile(target);
    if (!targetProvider) {
      throw new BadRequestException(`Unsupported auth file provider for account '${input.accountId}'`);
    }

    const siblings = authFiles.filter((entry) => {
      return this.resolveProviderFromAuthFile(entry) === targetProvider && this.isManageableAuthFile(entry);
    });

    const updates = [target, ...siblings.filter((entry) => entry.id !== target.id)].sort((left, right) => {
      /* Enable the chosen account first so one runtime failure cannot leave provider with zero active entries. */
      if (left.id === target.id) {
        return -1;
      }
      if (right.id === target.id) {
        return 1;
      }
      return left.name.localeCompare(right.name);
    });

    const originalDisabledByPath = new Map(
      updates.map((entry) => [this.requireFilePath(entry), entry.disabled] as const)
    );
    const appliedPaths: string[] = [];

    try {
      for (const entry of updates) {
        const filePath = this.requireFilePath(entry);
        await this.runtime.setDisabled({ filePath, disabled: entry.id !== target.id });
        appliedPaths.push(filePath);
      }
    } catch (error) {
      /* Best-effort rollback restores already-mutated entries to their observed pre-activation state. */
      for (const filePath of appliedPaths.reverse()) {
        try {
          await this.runtime.setDisabled({
            filePath,
            disabled: originalDisabledByPath.get(filePath) ?? false
          });
        } catch (rollbackError) {
          const rollbackDetails = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          this.logger.error(
            `Failed to rollback CLIProxy account activation for target='${target.id}' path='${filePath}': ${rollbackDetails}`
          );
        }
      }

      throw error;
    }
  }

  public async deleteAccount(input: { accountId: string }): Promise<void> {
    /* Deletion removes the auth file entirely and re-enables one sibling if the provider would become empty/disabled. */
    const authFiles = await this.api.getAuthFiles();
    const target = this.requireManageableAuthFile(authFiles, input.accountId);
    const targetProvider = this.resolveProviderFromAuthFile(target);
    if (!targetProvider) {
      throw new BadRequestException(`Unsupported auth file provider for account '${input.accountId}'`);
    }

    const remaining = authFiles.filter((entry) => {
      return entry.id !== target.id && this.resolveProviderFromAuthFile(entry) === targetProvider && this.isManageableAuthFile(entry);
    });

    const fallbackEntry = remaining
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))[0];

    /* Re-enable one deterministic sibling before deletion so provider never ends up with only disabled leftovers. */
    if (fallbackEntry && remaining.every((entry) => entry.disabled)) {
      await this.runtime.setDisabled({ filePath: this.requireFilePath(fallbackEntry), disabled: false });
    }

    await this.runtime.deleteFile({ filePath: this.requireFilePath(target) });
  }

  private parseCallbackUrl(value: string): { code?: string; state?: string; error?: string } {
    /* Browser callback URL can carry values in query or hash fragment depending on provider flow. */
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throw new BadRequestException("callbackUrl must be a valid URL");
    }

    const fromQuery = {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
      error: url.searchParams.get("error") ?? undefined
    };

    if (fromQuery.code || fromQuery.state || fromQuery.error) {
      return fromQuery;
    }

    const fragmentParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
    return {
      code: fragmentParams.get("code") ?? undefined,
      state: fragmentParams.get("state") ?? undefined,
      error: fragmentParams.get("error") ?? undefined
    };
  }

  private hasProviderApiKey(provider: CliproxyProviderId, config: Record<string, unknown>): boolean {
    /* API-key fields exist for providers where key-based onboarding bypasses OAuth auth-files. */
    const byProvider: Record<CliproxyProviderId, string[]> = {
      codex: ["codex-api-key"],
      anthropic: ["claude-api-key"],
      antigravity: [],
      kimi: [],
      qwen: [],
      iflow: []
    };

    return byProvider[provider].some((field) => {
      const value = config[field];
      return typeof value === "string" && value.trim().length > 0;
    });
  }

  private buildConnectedAccounts(authFiles: CliproxyAuthFile[], usageDetails: CliproxyUsageDetail[]): CliproxyConnectedAccount[] {
    /* Structured auth-file entries should expose human-readable account identity and observed per-account activity. */
    return authFiles
      .map((entry) => {
        const provider = this.resolveProviderFromAuthFile(entry);
        if (!provider) {
          return null;
        }

        const providerLabel = PROVIDER_DEFINITIONS.find((item) => item.id === provider)?.label ?? provider;
        return {
          id: entry.id,
          provider,
          providerLabel,
          name: entry.name,
          email: entry.email,
          account: entry.account,
          label: entry.label,
          disabled: entry.disabled,
          unavailable: entry.unavailable,
          canManage: this.isManageableAuthFile(entry),
          status: entry.status,
          statusMessage: entry.statusMessage,
          usage: this.buildUsageSummary(entry, usageDetails)
        };
      })
      .filter((entry): entry is CliproxyConnectedAccount => entry !== null)
      .sort((left, right) => left.providerLabel.localeCompare(right.providerLabel) || left.name.localeCompare(right.name));
  }

  private buildUsageSummary(
    entry: Pick<CliproxyAuthFile, "authIndex" | "id" | "name">,
    usageDetails: CliproxyUsageDetail[]
  ): CliproxyConnectedAccount["usage"] {
    /* Prefer runtime auth_index joins because they are stable across provider account naming differences. */
    const authIndex = String(entry.authIndex ?? "").trim();
    const accountMatchers = [authIndex, String(entry.id).trim(), String(entry.name).trim()].filter(Boolean);
    const matchedUsage = usageDetails.filter((detail) => {
      const detailIndex = String(detail.authIndex ?? "").trim();
      return detailIndex.length > 0 && accountMatchers.includes(detailIndex);
    });

    /* Aggregate only the request details bound to this concrete account identity. */
    const modelSet = new Set<string>();
    let requestCount = 0;
    let tokenCount = 0;
    let failedRequestCount = 0;
    let lastUsedAt: string | null = null;

    matchedUsage.forEach((detail) => {
      const safeTotalTokens = Number.isFinite(detail.totalTokens) ? Math.max(0, detail.totalTokens) : 0;

      requestCount += 1;
      tokenCount += safeTotalTokens;
      failedRequestCount += detail.failed ? 1 : 0;
      if (detail.model.trim()) {
        modelSet.add(detail.model.trim());
      }

      if (detail.timestamp && (!lastUsedAt || detail.timestamp > lastUsedAt)) {
        lastUsedAt = detail.timestamp;
      }
    });

    return {
      requestCount,
      tokenCount,
      failedRequestCount,
      models: Array.from(modelSet).sort((left, right) => left.localeCompare(right)),
      lastUsedAt
    };
  }

  private resolveProviderFromAuthFile(entry: CliproxyAuthFile): CliproxyProviderId | null {
    /* Prefer explicit provider from runtime auth manager, then fall back to filename markers. */
    const explicitProvider = this.normalizeProvider(entry.provider);
    if (explicitProvider) {
      return explicitProvider;
    }

    const loweredName = entry.name.toLowerCase();
    const match = PROVIDER_DEFINITIONS.find((provider) =>
      PROVIDER_FILE_MARKERS[provider.id].some((marker) => loweredName.includes(marker))
    );
    return match?.id ?? null;
  }

  private requireManageableAuthFile(authFiles: CliproxyAuthFile[], accountId: string): CliproxyAuthFile {
    /* Manual operations are limited to persisted OAuth auth files known to CLIProxy management API. */
    const target = authFiles.find((entry) => entry.id === accountId);
    if (!target) {
      throw new BadRequestException(`Unknown account: ${accountId}`);
    }
    if (!this.isManageableAuthFile(target)) {
      throw new BadRequestException(`Account '${accountId}' cannot be managed from Mini App`);
    }
    return target;
  }

  private isManageableAuthFile(entry: CliproxyAuthFile): boolean {
    /* Only persisted file-backed auth entries can be toggled or deleted safely. */
    return !entry.runtimeOnly && entry.source === "file" && typeof entry.path === "string" && entry.path.length > 0;
  }

  private requireFilePath(entry: CliproxyAuthFile): string {
    /* Runtime mutation path must be explicit to avoid editing the wrong auth entry. */
    if (!entry.path) {
      throw new BadRequestException(`Auth file path missing for account '${entry.id}'`);
    }
    return entry.path;
  }

  private normalizeProvider(provider: string | null): CliproxyProviderId | null {
    /* Management API uses external names like `claude`; map them into local provider ids. */
    const normalized = String(provider ?? "").trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    if (normalized === "claude" || normalized === "anthropic") {
      return "anthropic";
    }
    if (normalized === "codex" || normalized === "openai") {
      return "codex";
    }
    if (normalized === "antigravity") {
      return "antigravity";
    }
    if (normalized === "kimi") {
      return "kimi";
    }
    if (normalized === "qwen") {
      return "qwen";
    }
    if (normalized === "iflow") {
      return "iflow";
    }
    return null;
  }

  private assertProvider(provider: string): asserts provider is CliproxyProviderId {
    /* Provider ids must stay constrained to known management endpoints. */
    if (!PROVIDER_DEFINITIONS.some((item) => item.id === provider)) {
      throw new BadRequestException(`Unsupported provider: ${provider}`);
    }
  }
}
