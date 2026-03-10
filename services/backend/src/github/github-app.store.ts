/**
 * @fileoverview JSON store for the global GitHub PAT used by backend and OpenCode git helpers.
 *
 * Exports:
 * - GithubStoredToken (type) - Persisted GitHub PAT metadata plus secret.
 * - GithubTokenSummary (type) - Safe token metadata returned to service callers.
 * - GithubAppStore (class) - Reads and writes the global GitHub PAT payload.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";

const DATA_DIR = "data";
const STORE_FILE = "github.token.json";

export type GithubStoredToken = {
  adminId: number;
  token: string;
  updatedAt: string;
};

export type GithubTokenSummary = {
  adminId: number;
  token: string;
  tokenPreview: string;
  updatedAt: string;
};

type StoreShape = {
  token: GithubStoredToken | null;
};

const buildEmptyStore = (): StoreShape => ({
  token: null
});

@Injectable()
export class GithubAppStore {
  private readonly filePath: string;

  public constructor() {
    /* Keep store next to other backend runtime JSON files so self-hosted operators can back it up easily. */
    this.filePath = path.join(process.cwd(), DATA_DIR, STORE_FILE);
  }

  public saveToken(input: GithubStoredToken): void {
    /* Persist the single instance-wide PAT used by all future backend/opencode HTTPS git operations. */
    this.writeAll({ token: input });
  }

  public getToken(): GithubTokenSummary | null {
    /* Expose only a masked preview alongside the full secret needed by the credential helper. */
    const token = this.readAll().token;
    if (!token) {
      return null;
    }

    return {
      ...token,
      tokenPreview: this.maskToken(token.token)
    };
  }

  public deleteToken(): void {
    /* Clearing the store revokes runtime access immediately without inventing replacement credentials. */
    this.writeAll(buildEmptyStore());
  }

  private maskToken(token: string): string {
    /* UI should reveal only a tiny stable suffix so operators can identify which PAT is currently saved. */
    const trimmed = token.trim();
    if (trimmed.length <= 8) {
      return "saved";
    }

    return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
  }

  private readAll(): StoreShape {
    /* Ensure target directory exists before reading JSON payload. */
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.filePath)) {
      return buildEmptyStore();
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<StoreShape>;
      const token = parsed?.token;
      if (
        token &&
        typeof token.adminId === "number" &&
        typeof token.token === "string" &&
        typeof token.updatedAt === "string"
      ) {
        return { token };
      }

      return buildEmptyStore();
    } catch (error) {
      /* Surface malformed/corrupted store reads while still preserving service uptime. */
      const details = error instanceof Error ? error.message : String(error);
      console.error(`[GithubAppStore] Failed to read store JSON: ${details}`);
      return buildEmptyStore();
    }
  }

  private writeAll(data: StoreShape): void {
    /* Persist human-readable JSON for easier self-hosted operations/debug on server. */
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }
}
