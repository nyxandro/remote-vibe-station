/**
 * @fileoverview Store for the currently selected/active project.
 *
 * Exports:
 * - ActiveProjectStore - Persist active project slug across restarts.
 */

import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import { readJsonFileSync, writeJsonFileSyncAtomic } from "../storage/json-file";

const DATA_DIR = "data";
const ACTIVE_FILE = "active-project.json";

type ActiveFileV1 = { slug: string | null };

type ActiveFile = {
  /* Per-admin selection enables multiple parallel Telegram chats. */
  byAdminId: Record<string, { slug: string | null; updatedAt: string }>;
  /* Backward compatible/global selection. */
  global?: { slug: string | null; updatedAt: string };
};

@Injectable()
export class ActiveProjectStore {
  private readonly filePath: string;

  public constructor() {
    /* Persist selection near backend data volume. */
    this.filePath = path.join(process.cwd(), DATA_DIR, ACTIVE_FILE);
  }

  public get(adminId?: number): string | null {
    /* Load active project slug for admin (or global fallback). */
    const file = this.readFile();
    if (typeof adminId === "number") {
      return file.byAdminId[String(adminId)]?.slug ?? file.global?.slug ?? null;
    }
    return file.global?.slug ?? null;
  }

  public set(slug: string | null, adminId?: number): void {
    /* Persist the active project slug for admin (and keep global in sync when admin unknown). */
    const file = this.readFile();
    const now = new Date().toISOString();

    if (typeof adminId === "number") {
      file.byAdminId[String(adminId)] = { slug, updatedAt: now };
    } else {
      file.global = { slug, updatedAt: now };
    }

    this.writeFile(file);
  }

  public prune(input: {
    allowedAdminIds: number[];
    allowedSlugs: Set<string>;
  }): { removedAdmins: number; clearedSlugs: number } {
    /*
     * Keep the store consistent with reality:
     * - drop per-admin entries for admins that are no longer configured
     * - clear selections that point to deleted projects
     */
    const file = this.readFile();
    const allowedAdmins = new Set(input.allowedAdminIds.map((id) => String(id)));

    let removedAdmins = 0;
    for (const key of Object.keys(file.byAdminId)) {
      if (!allowedAdmins.has(key)) {
        delete file.byAdminId[key];
        removedAdmins += 1;
      }
    }

    let clearedSlugs = 0;
    for (const key of Object.keys(file.byAdminId)) {
      const current = file.byAdminId[key];
      if (current?.slug && !input.allowedSlugs.has(current.slug)) {
        file.byAdminId[key] = { slug: null, updatedAt: new Date().toISOString() };
        clearedSlugs += 1;
      }
    }

    if (file.global?.slug && !input.allowedSlugs.has(file.global.slug)) {
      file.global = { slug: null, updatedAt: new Date().toISOString() };
      clearedSlugs += 1;
    }

    if (removedAdmins > 0 || clearedSlugs > 0) {
      this.writeFile(file);
    }

    return { removedAdmins, clearedSlugs };
  }

  private readFile(): ActiveFile {
    /* Active selection is recoverable operational state, so prefer cleanup over crashing startup. */
    return readJsonFileSync({
      filePath: this.filePath,
      label: "active-project",
      createEmptyValue: () => ({ byAdminId: {}, global: { slug: null, updatedAt: new Date().toISOString() } }),
      normalize: (parsed) => {
        if (parsed && typeof parsed === "object" && "slug" in (parsed as Record<string, unknown>)) {
          const v1 = parsed as ActiveFileV1;
          return {
            byAdminId: {},
            global: { slug: v1.slug ?? null, updatedAt: new Date().toISOString() }
          };
        }

        const next = parsed as Partial<ActiveFile> | null | undefined;
        return {
          byAdminId:
            next?.byAdminId && typeof next.byAdminId === "object" && !Array.isArray(next.byAdminId)
              ? next.byAdminId
              : {},
          global:
            next?.global && typeof next.global === "object"
              ? {
                  slug: typeof next.global.slug === "string" || next.global.slug === null ? next.global.slug : null,
                  updatedAt:
                    typeof next.global.updatedAt === "string" ? next.global.updatedAt : new Date().toISOString()
                }
              : { slug: null, updatedAt: new Date().toISOString() }
        };
      },
      parseErrorStrategy: "recover",
      normalizeErrorStrategy: "recover"
    });
  }

  private writeFile(file: ActiveFile): void {
    /* Persist stable JSON. */
    writeJsonFileSyncAtomic(this.filePath, file);
  }
}
