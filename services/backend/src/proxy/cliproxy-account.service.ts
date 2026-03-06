/**
 * @fileoverview Domain service for CLIProxy account onboarding and status.
 *
 * Exports:
 * - CliproxyAccountState - UI payload with provider statuses.
 * - CliproxyOAuthStartInput - Provider selection payload.
 * - CliproxyOAuthCompleteInput - Callback/code payload.
 * - CliproxyAccountService - Builds statuses and proxies OAuth start/callback calls.
 */

import { BadRequestException, Injectable } from "@nestjs/common";

import { CliproxyManagementClient, CliproxyProviderId } from "./cliproxy-management.client";

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

export type CliproxyAccountState = {
  providers: ProviderState[];
  authFiles: string[];
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
  public constructor(private readonly api: CliproxyManagementClient) {}

  public async getState(): Promise<CliproxyAccountState> {
    /* State merges oauth auth-files and static API-key config fields into one provider list. */
    const [authFiles, config] = await Promise.all([this.api.getAuthFiles(), this.api.getConfig()]);
    const loweredAuthFiles = authFiles.map((item) => item.toLowerCase());

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
      providers,
      authFiles
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

  private assertProvider(provider: string): asserts provider is CliproxyProviderId {
    /* Provider ids must stay constrained to known management endpoints. */
    if (!PROVIDER_DEFINITIONS.some((item) => item.id === provider)) {
      throw new BadRequestException(`Unsupported provider: ${provider}`);
    }
  }
}
