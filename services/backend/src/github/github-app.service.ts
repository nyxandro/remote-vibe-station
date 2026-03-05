/**
 * @fileoverview GitHub App installation service for Telegram Mini App onboarding.
 *
 * Exports:
 * - GithubInstallStartResult (type) - Start-install response payload.
 * - GithubInstallCallbackQuery (type) - Callback query params from GitHub.
 * - GithubAppService (class) - Creates install URL, validates callbacks, stores bindings.
 */

import { createPrivateKey, createSign, randomBytes } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { GithubAppStore } from "./github-app.store";

const GITHUB_INSTALL_BASE_URL = "https://github.com/apps";
const GITHUB_API_BASE_URL = "https://api.github.com";
const STATE_TTL_MS = 15 * 60 * 1000;
const APP_JWT_SKEW_SECONDS = 60;
const APP_JWT_TTL_SECONDS = 8 * 60;
const TOKEN_TIMEOUT_MS = 15_000;

export type GithubInstallStartResult = {
  url: string;
  state: string;
  expiresAt: string;
};

export type GithubInstallCallbackQuery = {
  state?: string;
  installation_id?: string;
  setup_action?: string;
  account?: { login?: string; type?: string };
};

@Injectable()
export class GithubAppService {
  public constructor(
    @Inject(ConfigToken) private readonly config: AppConfig,
    private readonly store: GithubAppStore
  ) {}

  public startInstall(adminId: number): GithubInstallStartResult {
    /* Fail fast when mandatory GitHub App config is not provided. */
    const appSlug = this.requireConfiguredSlug();

    /* Keep pending-state storage bounded before writing a new state token. */
    this.store.pruneExpiredStates(new Date().toISOString());

    /* State token protects callback from CSRF and binds flow to admin. */
    const state = randomBytes(24).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + STATE_TTL_MS).toISOString();

    this.store.savePendingState({
      state,
      adminId,
      createdAt: now.toISOString(),
      expiresAt
    });

    const url = `${GITHUB_INSTALL_BASE_URL}/${encodeURIComponent(appSlug)}/installations/new?state=${encodeURIComponent(state)}`;
    return { url, state, expiresAt };
  }

  public completeInstall(query: GithubInstallCallbackQuery): {
    adminId: number;
    installationId: number;
    accountLogin: string;
    setupAction: string;
  } {
    /* Validate callback params explicitly to avoid partial/broken bindings. */
    const state = String(query.state ?? "").trim();
    const installationRaw = String(query.installation_id ?? "").trim();
    const setupAction = String(query.setup_action ?? "").trim() || "install";
    if (!state) {
      throw new Error("Missing state");
    }
    if (!installationRaw) {
      throw new Error("Missing installation_id");
    }

    const installationId = Number(installationRaw);
    if (!Number.isInteger(installationId) || installationId <= 0) {
      throw new Error("Invalid installation_id");
    }

    /* Consume one-time state and reject expired callback attempts. */
    const pending = this.store.consumePendingState(state);
    if (!pending) {
      throw new Error("State not found or already used");
    }

    const expiresAtMs = Date.parse(pending.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) {
      throw new Error("State expired");
    }

    /* Persist installation mapping so future operations can mint tokens on demand. */
    const accountLogin = String(query.account?.login ?? "").trim() || "unknown";
    const accountType = String(query.account?.type ?? "").trim() || "User";
    this.store.saveInstallation({
      adminId: pending.adminId,
      installationId,
      accountLogin,
      accountType,
      connectedAt: new Date().toISOString()
    });

    return { adminId: pending.adminId, installationId, accountLogin, setupAction };
  }

  public getStatus(adminId: number): {
    configured: boolean;
    connected: boolean;
    installationId?: number;
    accountLogin?: string;
    accountType?: string;
    connectedAt?: string;
  } {
    /* Return both config and binding status for Mini App settings screen. */
    const binding = this.store.getInstallation(adminId);
    return {
      configured: this.isConfigured(),
      connected: Boolean(binding),
      installationId: binding?.installationId,
      accountLogin: binding?.accountLogin,
      accountType: binding?.accountType,
      connectedAt: binding?.connectedAt
    };
  }

  public disconnect(adminId: number): { ok: true } {
    /* Explicitly remove installation mapping on user disconnect action. */
    this.store.deleteInstallation(adminId);
    return { ok: true };
  }

  public async createInstallationToken(adminId: number): Promise<{
    token: string;
    expiresAt: string;
  }> {
    /* Resolve binding first; without it we must fail fast with explicit error. */
    const binding = this.store.getInstallation(adminId);
    if (!binding) {
      throw new Error("GitHub is not connected for this admin");
    }

    const appId = this.requireConfiguredAppId();
    const appJwt = this.createAppJwt();
    const url = `${GITHUB_API_BASE_URL}/app/installations/${binding.installationId}/access_tokens`;

    /* Request short-lived token from GitHub App API for immediate git operations. */
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${appJwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": `remote-vibe-station/${appId}`
      },
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub token request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as { token?: string; expires_at?: string };
    const token = String(payload.token ?? "").trim();
    const expiresAt = String(payload.expires_at ?? "").trim();
    if (!token || !expiresAt) {
      throw new Error("GitHub token response is missing token or expires_at");
    }

    return { token, expiresAt };
  }

  private isConfigured(): boolean {
    /* Consider config valid only when all mandatory GitHub App fields are set. */
    return Boolean(
      this.config.githubAppId?.trim() &&
        this.config.githubAppSlug?.trim() &&
        this.config.githubAppPrivateKeyBase64?.trim()
    );
  }

  private requireConfiguredSlug(): string {
    /* Slug is required to generate public installation URL shown to user. */
    const slug = String(this.config.githubAppSlug ?? "").trim();
    if (!slug || !this.isConfigured()) {
      throw new Error(
        "GitHub App is not configured. Set GITHUB_APP_ID, GITHUB_APP_SLUG and GITHUB_APP_PRIVATE_KEY_BASE64"
      );
    }
    return slug;
  }

  private requireConfiguredAppId(): string {
    /* App ID is part of JWT issuer claim and audit-friendly User-Agent string. */
    const appId = String(this.config.githubAppId ?? "").trim();
    if (!appId || !this.isConfigured()) {
      throw new Error(
        "GitHub App is not configured. Set GITHUB_APP_ID, GITHUB_APP_SLUG and GITHUB_APP_PRIVATE_KEY_BASE64"
      );
    }
    return appId;
  }

  private createAppJwt(): string {
    /* Build RS256-signed JWT required by GitHub App authentication flow. */
    const appId = this.requireConfiguredAppId();
    const privateKeyPem = Buffer.from(
      String(this.config.githubAppPrivateKeyBase64 ?? ""),
      "base64"
    ).toString("utf-8");
    if (!privateKeyPem.trim()) {
      throw new Error("GITHUB_APP_PRIVATE_KEY_BASE64 is invalid or empty");
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const payload = {
      iat: nowSec - APP_JWT_SKEW_SECONDS,
      exp: nowSec + APP_JWT_TTL_SECONDS,
      iss: appId
    };

    const encodedHeader = this.base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
    const data = `${encodedHeader}.${encodedPayload}`;

    const signer = createSign("RSA-SHA256");
    signer.update(data);
    signer.end();
    const signature = signer.sign(createPrivateKey(privateKeyPem));
    const encodedSignature = this.base64UrlEncode(signature);
    return `${data}.${encodedSignature}`;
  }

  private base64UrlEncode(input: string | Buffer): string {
    /* Normalize base64 output to RFC 7515 URL-safe token format. */
    return Buffer.from(input)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }
}
