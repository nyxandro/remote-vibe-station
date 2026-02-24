/**
 * @fileoverview OpenCode provider authentication HTTP client.
 *
 * Exports:
 * - OpenCodeProviderAuthClient (L39) - Lists auth methods and performs provider connect/disconnect.
 */

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { formatOpenCodeHttpError } from "./opencode-http-error";

export type OpenCodeProviderAuthMethod = {
  type: "oauth" | "api";
  label: string;
};

export type OpenCodeProviderOAuthAuthorization = {
  url: string;
  method: "auto" | "code";
  instructions: string;
};

const PROVIDER_AUTH_TIMEOUT_MS = 15_000;

@Injectable()
export class OpenCodeProviderAuthClient {
  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {}

  public async listProviderAuthMethods(): Promise<Record<string, OpenCodeProviderAuthMethod[]>> {
    /* Mini App connect modal needs supported methods for each provider. */
    const response = await this.request<Record<string, OpenCodeProviderAuthMethod[]> | undefined>(
      "/provider/auth",
      { method: "GET" }
    );
    return response ?? {};
  }

  public async authorizeOAuth(input: {
    providerID: string;
    method: number;
  }): Promise<OpenCodeProviderOAuthAuthorization> {
    /* Start OAuth flow and return URL/instructions for browser handoff. */
    return this.request<OpenCodeProviderOAuthAuthorization>(
      `/provider/${encodeURIComponent(input.providerID)}/oauth/authorize`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: input.method })
      }
    );
  }

  public async completeOAuth(input: {
    providerID: string;
    method: number;
    code?: string;
  }): Promise<void> {
    /* Finalize OAuth flow using auto or code-based callback mode. */
    await this.request<boolean>(`/provider/${encodeURIComponent(input.providerID)}/oauth/callback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: input.method, code: input.code })
    });
  }

  public async setApiKey(input: { providerID: string; key: string }): Promise<void> {
    /* Store provider API key in OpenCode credential store. */
    await this.request<boolean>(`/auth/${encodeURIComponent(input.providerID)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "api", key: input.key })
    });
  }

  public async disconnectProvider(input: { providerID: string }): Promise<void> {
    /* Remove stored credentials for provider and mark it disconnected. */
    await this.request<boolean>(`/auth/${encodeURIComponent(input.providerID)}`, {
      method: "DELETE"
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    /* Execute authenticated OpenCode server request with optional basic auth. */
    const url = `${this.config.opencodeServerUrl}${path}`;
    const headers = new Headers(init.headers);

    if (this.config.opencodeServerPassword && this.config.opencodeServerUsername) {
      const credentials = `${this.config.opencodeServerUsername}:${this.config.opencodeServerPassword}`;
      const encoded = Buffer.from(credentials).toString("base64");
      headers.set("Authorization", `Basic ${encoded}`);
    }

    const response = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(PROVIDER_AUTH_TIMEOUT_MS)
    });
    if (!response.ok) {
      /* Bubble provider auth errors with explicit retry hints when available. */
      const bodyText = await response.text();
      throw new Error(
        formatOpenCodeHttpError({
          status: response.status,
          bodyText,
          retryAfterHeader: response.headers.get("retry-after")
        })
      );
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }
}
