/**
 * @fileoverview JSON store for Telegram model/agent/thinking preferences.
 *
 * Exports:
 * - TelegramPreferencesStore - Persist and load per-admin preferences.
 */

import * as path from "node:path";

import { Injectable } from "@nestjs/common";

import { AdminPreferences } from "./telegram-preferences.types";
import { readJsonFileSync, writeJsonFileSyncAtomic } from "../../storage/json-file";

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
    /* Preferences are per-admin UX state, so malformed JSON should recover to empty state. */
    return readJsonFileSync({
      filePath: this.filePath,
      label: "telegram-preferences",
      createEmptyValue: () => ({ byAdminId: {} }),
      normalize: (parsed) => {
        const file = parsed as StoreShape | null | undefined;
        return {
          byAdminId:
            file?.byAdminId && typeof file.byAdminId === "object" && !Array.isArray(file.byAdminId)
              ? file.byAdminId
              : {}
        };
      },
      parseErrorStrategy: "recover",
      normalizeErrorStrategy: "recover"
    });
  }

  private writeAll(file: StoreShape): void {
    /* Persist pretty JSON for manual debugging. */
    writeJsonFileSyncAtomic(this.filePath, file);
  }
}
