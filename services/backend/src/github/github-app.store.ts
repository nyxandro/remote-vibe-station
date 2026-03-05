/**
 * @fileoverview JSON store for GitHub App installation bindings and pending states.
 *
 * Exports:
 * - GithubPendingState (type) - One-time state token metadata.
 * - GithubInstallationBinding (type) - Persisted admin -> installation mapping.
 * - GithubAppStore (class) - Reads and writes GitHub App auth state.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";

const DATA_DIR = "data";
const STORE_FILE = "github.app.json";

export type GithubPendingState = {
  state: string;
  adminId: number;
  createdAt: string;
  expiresAt: string;
};

export type GithubInstallationBinding = {
  installationId: number;
  accountLogin: string;
  accountType: string;
  connectedAt: string;
};

type StoreShape = {
  byAdminId: Record<string, GithubInstallationBinding>;
  pendingStates: Record<string, GithubPendingState>;
};

const buildEmptyStore = (): StoreShape => ({
  byAdminId: {},
  pendingStates: {}
});

@Injectable()
export class GithubAppStore {
  private readonly filePath: string;

  public constructor() {
    /* Keep store near other backend runtime JSON files. */
    this.filePath = path.join(process.cwd(), DATA_DIR, STORE_FILE);
  }

  public savePendingState(input: GithubPendingState): void {
    /* Persist one-time state token before redirecting user to GitHub. */
    const data = this.readAll();
    data.pendingStates[input.state] = input;
    this.writeAll(data);
  }

  public consumePendingState(state: string): GithubPendingState | null {
    /* Read-and-delete state token to enforce one-time callback usage. */
    const data = this.readAll();
    const value = data.pendingStates[state] ?? null;
    if (!value) {
      return null;
    }

    /* Expired state tokens are dropped instead of being returned to caller. */
    const expires = Date.parse(value.expiresAt);
    if (!Number.isFinite(expires) || expires < Date.now()) {
      delete data.pendingStates[state];
      this.writeAll(data);
      return null;
    }

    delete data.pendingStates[state];
    this.writeAll(data);
    return value;
  }

  public pruneExpiredStates(nowISO: string): number {
    /* Remove stale pending states to keep JSON store bounded over time. */
    const data = this.readAll();
    const nowTime = Date.parse(nowISO);
    let removed = 0;

    for (const [state, item] of Object.entries(data.pendingStates)) {
      const expires = Date.parse(item.expiresAt);
      if (!Number.isFinite(expires) || expires < nowTime) {
        delete data.pendingStates[state];
        removed += 1;
      }
    }

    if (removed > 0) {
      this.writeAll(data);
    }
    return removed;
  }

  public saveInstallation(input: {
    adminId: number;
    installationId: number;
    accountLogin: string;
    accountType: string;
    connectedAt: string;
  }): void {
    /* Persist final admin -> GitHub installation mapping after callback. */
    const data = this.readAll();
    data.byAdminId[String(input.adminId)] = {
      installationId: input.installationId,
      accountLogin: input.accountLogin,
      accountType: input.accountType,
      connectedAt: input.connectedAt
    };
    this.writeAll(data);
  }

  public getInstallation(adminId: number): GithubInstallationBinding | null {
    /* Resolve installation mapping for admin-owned push/pull operations. */
    const data = this.readAll();
    return data.byAdminId[String(adminId)] ?? null;
  }

  public deleteInstallation(adminId: number): void {
    /* Explicit disconnect removes GitHub installation binding for admin. */
    const data = this.readAll();
    delete data.byAdminId[String(adminId)];
    this.writeAll(data);
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
      return {
        byAdminId: parsed?.byAdminId ?? {},
        pendingStates: parsed?.pendingStates ?? {}
      };
    } catch (error) {
      /* Surface malformed/corrupted store reads while still preserving service uptime. */
      const details = error instanceof Error ? error.message : String(error);
      console.error(`[GithubAppStore] Failed to read store JSON: ${details}`);
      return buildEmptyStore();
    }
  }

  private writeAll(data: StoreShape): void {
    /* Persist human-readable JSON for easier operations/debug on server. */
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }
}
