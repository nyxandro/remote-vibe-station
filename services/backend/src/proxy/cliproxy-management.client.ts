/**
 * @fileoverview Thin HTTP client for CLIProxy management API.
 *
 * Exports:
 * - CliproxyProviderId - Supported OAuth provider identifiers.
 * - CliproxyManagementClient - Calls management endpoints with secret header.
 */

import { BadGatewayException, Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";

const MANAGEMENT_TIMEOUT_MS = 20_000;
const MANAGEMENT_KEY_HEADER = "X-Management-Key";
const DEFAULT_MANAGEMENT_URL = "http://cliproxy:8317";

const PROVIDER_ENDPOINTS = {
  codex: "codex-auth-url",
  anthropic: "anthropic-auth-url",
  antigravity: "antigravity-auth-url",
  kimi: "kimi-auth-url",
  qwen: "qwen-auth-url",
  iflow: "iflow-auth-url"
} as const;

export type CliproxyProviderId = keyof typeof PROVIDER_ENDPOINTS;

type OAuthStartResponse = {
  status?: string;
  state?: string;
  url?: string;
};

type AuthFileListEntry = {
  id?: string;
  auth_index?: string;
  name?: string;
  provider?: string;
  label?: string;
  status?: string;
  status_message?: string;
  email?: string;
  account?: string;
};

export type CliproxyAuthFile = {
  id: string;
  authIndex: string | null;
  name: string;
  provider: string | null;
  label: string | null;
  status: string | null;
  statusMessage: string | null;
  email: string | null;
  account: string | null;
};

type UsageDetailEntry = {
  timestamp?: string;
  auth_index?: string;
  failed?: boolean;
  tokens?: {
    total_tokens?: number;
  };
};

type UsageModelEntry = {
  details?: UsageDetailEntry[];
};

type UsageApiEntry = {
  models?: Record<string, UsageModelEntry>;
};

type UsageSnapshotResponse = {
  usage?: {
    apis?: Record<string, UsageApiEntry>;
  };
};

export type CliproxyUsageDetail = {
  model: string;
  authIndex: string | null;
  timestamp: string | null;
  failed: boolean;
  totalTokens: number;
};

type CallbackInput = {
  provider: CliproxyProviderId;
  state: string;
  code?: string;
  error?: string;
};

@Injectable()
export class CliproxyManagementClient {
  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {}

  public async getAuthFiles(): Promise<CliproxyAuthFile[]> {
    /* Auth file list is the primary source of connected OAuth accounts. */
    const response = await this.request<{ files?: Array<string | AuthFileListEntry> }>("/v0/management/auth-files", {
      method: "GET"
    });
    if (!response || typeof response !== "object") {
      return [];
    }

    if (!Array.isArray(response.files)) {
      return [];
    }

    /* Older runtimes may still return plain filenames; newer builds return structured account records. */
    return response.files
      .map((item) => this.normalizeAuthFile(item))
      .filter((item): item is CliproxyAuthFile => item !== null);
  }

  public async getConfig(): Promise<Record<string, unknown>> {
    /* Config payload contains API-key based account fields for several providers. */
    const response = await this.request<Record<string, unknown>>("/v0/management/config", {
      method: "GET"
    });
    return response && typeof response === "object" ? response : {};
  }

  public async getUsageStatisticsEnabled(): Promise<boolean> {
    /* Usage tracking toggle tells UI whether zero counters are real or just disabled telemetry. */
    const response = await this.request<{ "usage-statistics-enabled"?: boolean }>(
      "/v0/management/usage-statistics-enabled",
      { method: "GET" }
    );
    return response?.["usage-statistics-enabled"] === true;
  }

  public async getUsage(): Promise<CliproxyUsageDetail[]> {
    /* Usage snapshot exposes request details with auth_index so callers can aggregate per account. */
    const response = await this.request<UsageSnapshotResponse>("/v0/management/usage", {
      method: "GET"
    });
    const apis = response?.usage?.apis;
    if (!apis || typeof apis !== "object") {
      return [];
    }

    return Object.values(apis).flatMap((apiEntry) => {
      const models = apiEntry?.models;
      if (!models || typeof models !== "object") {
        return [];
      }

      return Object.entries(models).flatMap(([model, modelEntry]) => {
        const details = Array.isArray(modelEntry?.details) ? modelEntry.details : [];
        return details.map((detail) => ({
          model,
          authIndex:
            typeof detail?.auth_index === "string" && detail.auth_index.trim() ? detail.auth_index.trim() : null,
          timestamp:
            typeof detail?.timestamp === "string" && detail.timestamp.trim() ? detail.timestamp.trim() : null,
          failed: detail?.failed === true,
          totalTokens: Number.isFinite(detail?.tokens?.total_tokens)
            ? Math.max(0, Number(detail?.tokens?.total_tokens))
            : 0
        }));
      });
    });
  }

  public async startOAuth(provider: CliproxyProviderId): Promise<{ provider: CliproxyProviderId; state: string; url: string }> {
    /* Dedicated auth-url endpoints initialize provider OAuth/device flow in CLIProxy. */
    const endpoint = PROVIDER_ENDPOINTS[provider];
    const payload = await this.request<OAuthStartResponse>(`/v0/management/${endpoint}`, {
      method: "GET"
    });

    const state = payload && typeof payload.state === "string" ? payload.state.trim() : "";
    const url = payload && typeof payload.url === "string" ? payload.url.trim() : "";
    if (!state || !url) {
      throw new BadGatewayException(`CLIProxy returned invalid OAuth payload for provider '${provider}'`);
    }

    return { provider, state, url };
  }

  public async completeOAuth(input: CallbackInput): Promise<void> {
    /* OAuth callback endpoint exchanges provider code/error using tracked state. */
    await this.request<Record<string, unknown>>("/v0/management/oauth-callback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    /* Management API is private; every call must include secret header and timeout. */
    const managementPassword = this.config.cliproxyManagementPassword;
    if (!managementPassword) {
      throw new BadGatewayException("CLIPROXY_MANAGEMENT_PASSWORD is not configured");
    }

    const baseUrl = this.config.cliproxyManagementUrl ?? DEFAULT_MANAGEMENT_URL;
    const url = `${baseUrl}${path}`;
    const headers = new Headers(init.headers);
    headers.set(MANAGEMENT_KEY_HEADER, managementPassword);

    const response = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(MANAGEMENT_TIMEOUT_MS)
    });

    const body = await response.text();
    if (!response.ok) {
      throw new BadGatewayException(
        `CLIProxy management request failed (${response.status}) at '${path}': ${body || "empty response"}`
      );
    }

    if (!body) {
      /* Some management endpoints intentionally return empty body on success. */
      return null as unknown as T;
    }

    /* Parse failures should include endpoint context and raw payload for debugging. */
    try {
      return JSON.parse(body) as T;
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new BadGatewayException(
        `CLIProxy management returned invalid JSON at '${path}': ${details}; body: ${body}`
      );
    }
  }

  private normalizeAuthFile(item: string | AuthFileListEntry): CliproxyAuthFile | null {
    /* Normalize both legacy filename entries and newer structured auth manager payloads. */
    if (typeof item === "string") {
      const normalized = item.trim();
      if (!normalized) {
        return null;
      }
      return {
        id: normalized,
        authIndex: null,
        name: normalized,
        provider: null,
        label: null,
        status: null,
        statusMessage: null,
        email: null,
        account: null
      };
    }

    if (!item || typeof item !== "object") {
      return null;
    }

    const id = String(item.id ?? item.name ?? "").trim();
    const name = String(item.name ?? item.id ?? "").trim();
    if (!id || !name) {
      return null;
    }

    return {
      id,
      authIndex: typeof item.auth_index === "string" && item.auth_index.trim() ? item.auth_index.trim() : null,
      name,
      provider: typeof item.provider === "string" && item.provider.trim() ? item.provider.trim() : null,
      label: typeof item.label === "string" && item.label.trim() ? item.label.trim() : null,
      status: typeof item.status === "string" && item.status.trim() ? item.status.trim() : null,
      statusMessage:
        typeof item.status_message === "string" && item.status_message.trim() ? item.status_message.trim() : null,
      email: typeof item.email === "string" && item.email.trim() ? item.email.trim() : null,
      account: typeof item.account === "string" && item.account.trim() ? item.account.trim() : null
    };
  }
}
