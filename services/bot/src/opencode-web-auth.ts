/**
 * @fileoverview JSON-backed one-time links and long-lived browser sessions for OpenCode UI.
 *
 * Exports:
 * - OpenCodeWebAuthServiceOptions (L34) - Configuration contract for TTLs and storage path.
 * - IssueMagicLinkInput (L41) - Input for short-lived Telegram-issued link generation.
 * - ExchangeMagicLinkInput (L45) - Input for link exchange into device session.
 * - VerifySessionInput (L50) - Input for cookie session validation.
 * - OpenCodeWebAuthService (L67) - Persistent auth state service (tokens + sessions).
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const STORAGE_FILE_MODE = 0o600;
const SHA256 = "sha256";
const UTF8 = "utf-8";
const TOKEN_BYTE_LENGTH = 32;
const TEMP_FILE_SUFFIX = ".tmp";

type WebAuthTokenRecord = {
  tokenHash: string;
  adminId: number;
  expiresAt: number;
  usedAt?: number;
};

type WebAuthSessionRecord = {
  sessionHash: string;
  adminId: number;
  fingerprintHash: string;
  expiresAt: number;
};

type WebAuthState = {
  tokens: WebAuthTokenRecord[];
  sessions: WebAuthSessionRecord[];
};

export type OpenCodeWebAuthServiceOptions = {
  storageFilePath: string;
  linkTtlMs: number;
  sessionTtlMs: number;
  now?: () => number;
};

export type IssueMagicLinkInput = {
  adminId: number;
};

export type ExchangeMagicLinkInput = {
  token: string;
  fingerprint: string;
};

export type VerifySessionInput = {
  sessionId: string;
  fingerprint: string;
};

export type ExchangeMagicLinkResult = {
  sessionId: string;
  adminId: number;
};

const EMPTY_STATE: WebAuthState = {
  tokens: [],
  sessions: []
};

export class OpenCodeWebAuthService {
  private readonly storageFilePath: string;
  private readonly linkTtlMs: number;
  private readonly sessionTtlMs: number;
  private readonly now: () => number;
  private operationQueue: Promise<void> = Promise.resolve();

  public constructor(options: OpenCodeWebAuthServiceOptions) {
    /* Persist immutable runtime configuration and fail fast on invalid TTL values. */
    if (!Number.isFinite(options.linkTtlMs) || options.linkTtlMs <= 0) {
      throw new Error("linkTtlMs must be a positive number");
    }
    if (!Number.isFinite(options.sessionTtlMs) || options.sessionTtlMs <= 0) {
      throw new Error("sessionTtlMs must be a positive number");
    }

    this.storageFilePath = options.storageFilePath;
    this.linkTtlMs = options.linkTtlMs;
    this.sessionTtlMs = options.sessionTtlMs;
    this.now = options.now ?? (() => Date.now());
  }

  public async issueMagicLink(input: IssueMagicLinkInput): Promise<string> {
    /* Create a short-lived one-time token bound to the target Telegram admin id. */
    const token = this.generateOpaqueToken();
    const tokenHash = this.hashValue(token);
    const nowMs = this.now();

    await this.withLockedState(async (state) => {
      this.pruneExpiredState(state, nowMs);
      state.tokens.push({
        tokenHash,
        adminId: input.adminId,
        expiresAt: nowMs + this.linkTtlMs
      });
    });

    return token;
  }

  public getLinkTtlMs(): number {
    /* Expose configured magic-link TTL for user-facing command hints. */
    return this.linkTtlMs;
  }

  public getSessionTtlMs(): number {
    /* Expose configured session TTL for user-facing command hints. */
    return this.sessionTtlMs;
  }

  public async exchangeMagicLink(input: ExchangeMagicLinkInput): Promise<ExchangeMagicLinkResult> {
    /* Consume link once and mint a long-lived device session id. */
    const nowMs = this.now();
    const tokenHash = this.hashValue(input.token);
    const fingerprintHash = this.hashValue(input.fingerprint);
    const sessionId = this.generateOpaqueToken();
    const sessionHash = this.hashValue(sessionId);

    return this.withLockedState(async (state) => {
      this.pruneExpiredState(state, nowMs);
      const tokenRecord = state.tokens.find(
        (item) => item.tokenHash === tokenHash && typeof item.usedAt === "undefined" && nowMs < item.expiresAt
      );

      if (!tokenRecord) {
        throw new Error("Magic link is invalid or expired");
      }

      tokenRecord.usedAt = nowMs;
      state.sessions.push({
        sessionHash,
        adminId: tokenRecord.adminId,
        fingerprintHash,
        expiresAt: nowMs + this.sessionTtlMs
      });

      return {
        sessionId,
        adminId: tokenRecord.adminId
      };
    });
  }

  public async verifySession(input: VerifySessionInput): Promise<{ adminId: number } | null> {
    /* Validate cookie session and enforce same-device fingerprint binding. */
    const nowMs = this.now();
    const sessionHash = this.hashValue(input.sessionId);
    const fingerprintHash = this.hashValue(input.fingerprint);

    return this.withLockedState(async (state) => {
      const session = state.sessions.find(
        (item) =>
          item.sessionHash === sessionHash &&
          item.fingerprintHash === fingerprintHash &&
          nowMs < item.expiresAt
      );

      if (!session) {
        return null;
      }

      return {
        adminId: session.adminId
      };
    }, false);
  }

  private async withLockedState<T>(
    operation: (state: WebAuthState) => Promise<T> | T,
    shouldPersist: boolean = true
  ): Promise<T> {
    /* Serialize mutations to avoid race conditions between concurrent requests. */
    const run = async (): Promise<T> => {
      const state = await this.readState();
      const result = await operation(state);
      if (shouldPersist) {
        await this.writeState(state);
      }
      return result;
    };

    const next = this.operationQueue.then(run, run);
    this.operationQueue = next.then(
      () => undefined,
      () => undefined
    );

    return next;
  }

  private async readState(): Promise<WebAuthState> {
    /* Load JSON state from disk or create an empty state on first use. */
    try {
      const raw = await fs.readFile(this.storageFilePath, UTF8);
      const parsed = JSON.parse(raw) as Partial<WebAuthState>;
      return {
        tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : []
      };
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === "ENOENT") {
        return {
          tokens: [...EMPTY_STATE.tokens],
          sessions: [...EMPTY_STATE.sessions]
        };
      }
      throw error;
    }
  }

  private async writeState(state: WebAuthState): Promise<void> {
    /* Persist auth state atomically and keep file permissions restrictive. */
    const directory = path.dirname(this.storageFilePath);
    const tempFilePath = `${this.storageFilePath}${TEMP_FILE_SUFFIX}`;
    await fs.mkdir(directory, { recursive: true });

    try {
      await fs.writeFile(tempFilePath, JSON.stringify(state, null, 2), {
        encoding: UTF8,
        mode: STORAGE_FILE_MODE
      });
      await fs.chmod(tempFilePath, STORAGE_FILE_MODE);
      await fs.rename(tempFilePath, this.storageFilePath);
      await fs.chmod(this.storageFilePath, STORAGE_FILE_MODE);
    } catch (error) {
      await fs.rm(tempFilePath, { force: true });
      throw error;
    }
  }

  private pruneExpiredState(state: WebAuthState, nowMs: number): void {
    /* Remove expired sessions and expired/used tokens to keep storage bounded. */
    state.sessions = state.sessions.filter((item) => nowMs < item.expiresAt);
    state.tokens = state.tokens.filter((item) => nowMs < item.expiresAt && typeof item.usedAt === "undefined");
  }

  private hashValue(value: string): string {
    /* Hash sensitive ids so raw tokens are never persisted to disk. */
    return crypto.createHash(SHA256).update(value, UTF8).digest("hex");
  }

  private generateOpaqueToken(): string {
    /* Generate URL-safe random identifiers for links and sessions. */
    return crypto.randomBytes(TOKEN_BYTE_LENGTH).toString("base64url");
  }
}
