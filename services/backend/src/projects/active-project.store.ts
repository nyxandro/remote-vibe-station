/**
 * @fileoverview Store for the currently selected/active project.
 *
 * Exports:
 * - ActiveProjectStore (L17) - Persist active project slug across restarts.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";

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
    /* Ensure directory exists. */
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.filePath)) {
      return { byAdminId: {}, global: { slug: null, updatedAt: new Date().toISOString() } };
    }

    const raw = fs.readFileSync(this.filePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    /* Backward compatibility: v1 stored only { slug }. */
    if (parsed && typeof parsed === "object" && "slug" in (parsed as any)) {
      const v1 = parsed as ActiveFileV1;
      return {
        byAdminId: {},
        global: { slug: v1.slug ?? null, updatedAt: new Date().toISOString() }
      };
    }

    /* Default to the new schema. */
    const next = parsed as ActiveFile;
    if (!next.byAdminId) {
      next.byAdminId = {};
    }
    if (!next.global) {
      next.global = { slug: null, updatedAt: new Date().toISOString() };
    }
    return next;
  }

  private writeFile(file: ActiveFile): void {
    /* Persist stable JSON. */
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), "utf-8");
  }
}
