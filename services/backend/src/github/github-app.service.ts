/**
 * @fileoverview Global GitHub PAT service for Mini App onboarding and git credential minting.
 *
 * Exports:
 * - GithubAuthStatus (type) - Current global PAT status returned to Mini App.
 * - GithubAppService (class) - Persists PAT and exposes git credential payload for backend/opencode.
 */

import { Injectable } from "@nestjs/common";

import { GithubAppStore } from "./github-app.store";

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

@Injectable()
export class GithubAppService {
  public constructor(private readonly store: GithubAppStore) {}

  public getStatus(_adminId: number): GithubAuthStatus {
    /* PAT auth is instance-wide, so every admin sees the same global credential state. */
    const token = this.store.getToken();
    return {
      configured: true,
      connected: Boolean(token),
      tokenPreview: token?.tokenPreview,
      updatedAt: token?.updatedAt,
      gitCredential: {
        connected: Boolean(token),
        mode: "pat",
        updatedAt: token?.updatedAt
      }
    };
  }

  public saveToken(input: { adminId: number; token: string }): { ok: true } {
    /* Save a single global PAT that backend and OpenCode will reuse for all GitHub HTTPS operations. */
    const token = String(input.token ?? "").trim();
    if (!token) {
      throw new Error("GitHub token is required");
    }

    this.store.saveToken({
      adminId: input.adminId,
      token,
      updatedAt: new Date().toISOString()
    });
    return { ok: true };
  }

  public disconnect(_adminId: number): { ok: true } {
    /* Removing the stored PAT immediately disables future HTTPS git auth for all projects. */
    this.store.deleteToken();
    return { ok: true };
  }

  public getStoredToken(): string | null {
    /* Runtime services may reuse the saved PAT for GitHub API requests that should not hit anonymous rate limits. */
    return this.store.getToken()?.token ?? null;
  }

  public async createGitCredential(input?: {
    protocol?: string;
    host?: string;
    path?: string;
  }): Promise<{
    username: string;
    password: string;
    mode: "pat";
    updatedAt: string;
  }> {
    /* Keep the helper tightly scoped so non-GitHub remotes never receive unrelated secrets. */
    const host = String(input?.host ?? "").trim().toLowerCase();
    const protocol = String(input?.protocol ?? "https").trim().toLowerCase();
    if (host !== "github.com" || protocol !== "https") {
      throw new Error("GitHub git credential helper supports only https://github.com");
    }

    /* Fail fast when no PAT is configured because fake fallbacks would make git failures harder to debug. */
    const token = this.store.getToken();
    if (!token) {
      throw new Error("GitHub token is not configured");
    }

    return {
      username: "git",
      password: token.token,
      mode: "pat",
      updatedAt: token.updatedAt
    };
  }
}
