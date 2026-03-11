/**
 * @fileoverview JSON store for the global GitHub PAT used by backend and OpenCode git helpers.
 *
 * Exports:
 * - GithubStoredToken - Persisted GitHub PAT metadata plus secret.
 * - GithubTokenSummary - Safe token metadata returned to service callers.
 * - GithubAppStore - Reads and writes the global GitHub PAT payload.
 */

import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import { readJsonFileSync, writeJsonFileSyncAtomic } from "../storage/json-file";

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
    /* PAT storage should recover to empty state when the file is malformed instead of crashing runtime helpers. */
    return readJsonFileSync({
      filePath: this.filePath,
      label: "github-token",
      createEmptyValue: buildEmptyStore,
      normalize: (parsed) => {
        const store = parsed as Partial<StoreShape> | null | undefined;
        const token = store?.token;
        if (
          token &&
          typeof token.adminId === "number" &&
          typeof token.token === "string" &&
          typeof token.updatedAt === "string"
        ) {
          return { token };
        }

        return buildEmptyStore();
      },
      parseErrorStrategy: "recover",
      normalizeErrorStrategy: "recover"
    });
  }

  private writeAll(data: StoreShape): void {
    /* Persist human-readable JSON for easier self-hosted operations/debug on server. */
    writeJsonFileSyncAtomic(this.filePath, data);
  }
}
