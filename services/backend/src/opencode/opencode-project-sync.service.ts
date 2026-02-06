/**
 * @fileoverview Sync discovered PROJECTS_ROOT folders into OpenCode project storage.
 *
 * Why this exists:
 * - OpenCode API does not provide a stable "register project by path" endpoint.
 * - For dev UX we want OpenCode to show all folders as projects.
 * - We implement a best-effort sync by writing OpenCode's storage JSON files.
 *
 * Exports:
 * - OpenCodeProjectSyncService (L26) - Writes/updates storage/project/*.json files.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Inject, Injectable, OnModuleInit } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { discoverProjects } from "../projects/project-discovery";
import { assertWithinRoot } from "../projects/project-paths";
import { OpenCodeProjectRecord, toOpenCodeProjectRecord } from "./opencode-project-storage";

const STORAGE_RELATIVE_DIR = path.join("storage", "project");
const JSON_EXT = ".json";
const OPENCODE_DATA_MOUNT_PATH = "/opencode-data";

const OPEN_CODE_ICON_COLORS = [
  "cyan",
  "blue",
  "green",
  "orange",
  "pink",
  "purple",
  "red",
  "teal",
  "yellow"
] as const;

type SyncResult = {
  scanned: number;
  created: number;
  updated: number;
  skipped: number;
  apiInitialized: number;
  opencodeStorageDir?: string;
};

type WarmRecentsResult = {
  scanned: number;
  warmed: number;
  skipped: number;
  limit: number;
};

@Injectable()
export class OpenCodeProjectSyncService implements OnModuleInit {
  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {}

  public onModuleInit(): void {
    /* Best-effort startup sync for dev UX; controlled by config. */
    if (!this.config.opencodeSyncOnStart) {
      return;
    }

    /* Fire-and-forget; never block or crash the app on startup. */
    void this.sync().catch(() => undefined);

    /* Optional: warm OpenCode recents for all projects. */
    if (this.config.opencodeWarmRecentsOnStart) {
      void this.warmRecents().catch(() => undefined);
    }
  }

  public async sync(): Promise<SyncResult> {
    /*
     * Fail fast if OPENCODE_DATA_DIR is not configured.
     * This hack requires direct filesystem access to OpenCode's volume.
     */
    if (!this.config.opencodeDataDir && !fs.existsSync(OPENCODE_DATA_MOUNT_PATH)) {
      return { scanned: 0, created: 0, updated: 0, skipped: 0, apiInitialized: 0 };
    }

    /*
     * Prefer writing into the container mount path when available.
     * This keeps host paths out of container logic.
     */
    const baseDir = fs.existsSync(OPENCODE_DATA_MOUNT_PATH)
      ? OPENCODE_DATA_MOUNT_PATH
      : this.config.opencodeDataDir!;

    const opencodeStorageDir = path.join(baseDir, STORAGE_RELATIVE_DIR);
    if (!fs.existsSync(opencodeStorageDir)) {
      fs.mkdirSync(opencodeStorageDir, { recursive: true });
    }

    /*
     * Discover project folders.
     * We intentionally include non-runnable projects too.
     */
    const projects = discoverProjects({ projectsRoot: this.config.projectsRoot });
    const nowMs = Date.now();

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let apiInitialized = 0;

    for (const p of projects) {
      /*
       * Write one JSON file per project.
       * OpenCode expects id to match filename (best-effort).
       */
      const id = p.slug;
      const record = toOpenCodeProjectRecord({
        id,
        worktree: p.rootPath,
        nowMs,
        name: p.name
      });

      /*
       * OpenCode UI seems to rely on icon metadata for rendering project cards.
       * When a user manually adds a project, OpenCode writes icon.color.
       * We set a deterministic color to make projects visible immediately.
       */
      const color =
        OPEN_CODE_ICON_COLORS[Math.abs(hashString(id)) % OPEN_CODE_ICON_COLORS.length];
      record.icon = { color };

      const filePath = path.join(opencodeStorageDir, `${id}${JSON_EXT}`);
      assertWithinRoot(opencodeStorageDir, filePath);

      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
        created += 1;
      } else {
        /*
         * If the project already exists, update only when relevant fields differ.
         * We do not want to churn timestamps on every sync.
         */
        const existingRaw = fs.readFileSync(filePath, "utf-8");
        const existing = JSON.parse(existingRaw) as OpenCodeProjectRecord;

        const needsWorktreeUpdate = existing.worktree !== record.worktree;
        const needsIconUpdate = !existing.icon && Boolean(record.icon);
        const needsNameUpdate = !existing.name && Boolean(record.name);

        if (!needsWorktreeUpdate && !needsIconUpdate && !needsNameUpdate) {
          skipped += 1;
        } else {
          const next: OpenCodeProjectRecord = {
            ...existing,
            worktree: record.worktree,
            name: existing.name ?? record.name,
            icon: existing.icon ?? record.icon,
            time: {
              created: existing.time?.created ?? nowMs,
              updated: nowMs
            }
          };

          fs.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf-8");
          updated += 1;
        }
      }

      /*
       * Critical: OpenCode UI uses an internal projectID (hash) derived from directory.
       * Our storage hack writes slug-based IDs which the UI may ignore.
       *
       * Best-effort fix: initialize the internal project record via OpenCode API by
       * creating+deleting a bootstrap session for that directory, then patching
       * the derived projectID with name/icon.
       */
      /*
       * OpenCode derives a projectID per directory only for git repositories.
       * For non-git folders it falls back to the global project.
       */
      const isGit = fs.existsSync(path.join(p.rootPath, ".git"));
      if (!isGit) {
        continue;
      }

      try {
        await this.ensureApiProject({ directory: p.rootPath, name: p.name, color });
        apiInitialized += 1;
      } catch {
        // Non-fatal; keep syncing other projects.
      }
    }

    return {
      scanned: projects.length,
      created,
      updated,
      skipped,
      apiInitialized,
      opencodeStorageDir
    };
  }

  public async warmRecents(): Promise<WarmRecentsResult> {
    /*
     * Populate OpenCode "Recent projects" by opening each directory once.
     * We create and immediately delete a session for the directory.
     */
    const projects = discoverProjects({ projectsRoot: this.config.projectsRoot });
    const limit = this.config.opencodeWarmRecentsLimit;
    const slice = projects.slice(0, limit);

    let warmed = 0;
    let skipped = 0;

    for (const p of slice) {
      try {
        /* Skip if OpenCode already has a root session for the directory. */
        const existing = await this.request<Array<{ id: string }>>(
          `/session?directory=${encodeURIComponent(p.rootPath)}&roots=true&limit=1`,
          { method: "GET" }
        );
        if (existing.length > 0) {
          skipped += 1;
          continue;
        }

        const session = await this.request<{ id: string }>(
          `/session?directory=${encodeURIComponent(p.rootPath)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            /* Keep session so OpenCode sidebar can list the project. */
            body: JSON.stringify({ title: "Home" })
          }
        );
        warmed += 1;
      } catch {
        skipped += 1;
      }
    }

    return { scanned: projects.length, warmed, skipped, limit };
  }

  private async ensureApiProject(input: {
    directory: string;
    name: string;
    color: string;
  }): Promise<void> {
    /*
     * Create a bootstrap session to force OpenCode to register the directory.
     * We immediately delete it to avoid polluting the session list.
     */
    const session = await this.request<{ id: string; projectID?: string }>(
      `/session?directory=${encodeURIComponent(input.directory)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Bootstrap" })
      }
    );

    /* Always clean up the bootstrap session. */
    await this.request(`/session/${session.id}`, { method: "DELETE" });

    /* If OpenCode fell back to global project, there's nothing to patch. */
    if (session.projectID === "global") {
      return;
    }

    /*
     * Resolve the derived project id and patch its metadata.
     * We select the 40-hex id for the exact worktree.
     */
    const projects = await this.request<Array<{ id: string; worktree: string }>>(
      `/project?directory=${encodeURIComponent(input.directory)}`,
      { method: "GET" }
    );

    const derived = projects.find(
      (p) => p.worktree === input.directory && /^[0-9a-f]{40}$/i.test(p.id)
    );

    if (!derived) {
      throw new Error(`Derived OpenCode project id not found for: ${input.directory}`);
    }

    await this.request(
      `/project/${derived.id}?directory=${encodeURIComponent(input.directory)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: input.name, icon: { color: input.color } })
      }
    );
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    /*
     * Direct OpenCode API call with optional basic auth.
     * This service runs in backend container, so it uses OPENCODE_SERVER_URL.
     */
    const url = `${this.config.opencodeServerUrl}${path}`;
    const headers = new Headers(init.headers);

    if (this.config.opencodeServerPassword && this.config.opencodeServerUsername) {
      const credentials = `${this.config.opencodeServerUsername}:${this.config.opencodeServerPassword}`;
      const encoded = Buffer.from(credentials).toString("base64");
      headers.set("Authorization", `Basic ${encoded}`);
    }

    const response = await fetch(url, { ...init, headers });
    if (!response.ok) {
      throw new Error(`OpenCode request failed: ${response.status}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

const hashString = (value: string): number => {
  /*
   * Tiny deterministic hash for stable icon colors.
   * We keep it simple: this is UX-only metadata.
   */
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash;
};
