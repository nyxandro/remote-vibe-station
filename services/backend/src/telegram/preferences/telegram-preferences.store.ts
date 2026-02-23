/**
 * @fileoverview JSON store for Telegram model/agent/thinking preferences.
 *
 * Exports:
 * - TelegramPreferencesStore (L23) - Persist and load per-admin preferences.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";

import { AdminPreferences } from "./telegram-preferences.types";

const DATA_DIR = "data";
const STORE_FILE = "telegram.preferences.json";

type StoreShape = {
  byAdminId: Record<string, AdminPreferences>;
};

@Injectable()
export class TelegramPreferencesStore {
  private readonly filePath: string;

  public constructor() {
    /* Persist settings near backend data volume. */
    this.filePath = path.join(process.cwd(), DATA_DIR, STORE_FILE);
  }

  public get(adminId: number): AdminPreferences {
    /* Return persisted preferences or empty object when missing. */
    const file = this.readAll();
    return file.byAdminId[String(adminId)] ?? {};
  }

  public set(adminId: number, next: AdminPreferences): AdminPreferences {
    /* Replace preferences for admin and persist atomically. */
    const file = this.readAll();
    file.byAdminId[String(adminId)] = next;
    this.writeAll(file);
    return next;
  }

  public pruneToAdmins(input: { allowedAdminIds: number[] }): { before: number; after: number; removed: number } {
    /*
     * Keep the file bounded to configured admins.
     * This is mostly a safety net; the store is naturally small.
     */
    const file = this.readAll();
    const before = Object.keys(file.byAdminId).length;

    const ids = Array.isArray(input?.allowedAdminIds) ? input.allowedAdminIds : [];
    const allowed = new Set(ids.map((id) => String(id)));
    for (const key of Object.keys(file.byAdminId)) {
      if (!allowed.has(key)) {
        delete file.byAdminId[key];
      }
    }

    const after = Object.keys(file.byAdminId).length;
    const removed = before - after;
    if (removed > 0) {
      this.writeAll(file);
    }
    return { before, after, removed };
  }

  private readAll(): StoreShape {
    /* Ensure data directory exists before reading. */
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.filePath)) {
      return { byAdminId: {} };
    }

    const raw = fs.readFileSync(this.filePath, "utf-8");
    try {
      const parsed = JSON.parse(raw) as StoreShape;
      if (!parsed || typeof parsed !== "object" || !parsed.byAdminId) {
        return { byAdminId: {} };
      }
      return parsed;
    } catch {
      return { byAdminId: {} };
    }
  }

  private writeAll(file: StoreShape): void {
    /* Persist pretty JSON for manual debugging. */
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), "utf-8");
  }
}
