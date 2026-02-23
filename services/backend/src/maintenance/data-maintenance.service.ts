/**
 * @fileoverview Periodic retention/cleanup for backend data volume (`/app/data`).
 *
 * Why:
 * - The backend stores several JSON files under `data/` for reliability and UX.
 * - Without retention, these files can grow indefinitely (especially diff previews and outbox).
 * - Cleanup must be best-effort and never block or crash application startup.
 *
 * Exports:
 * - DataMaintenanceService (L34) - Runs periodic cleanup for all `data/` stores.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { EventsService } from "../events/events.service";
import { discoverProjects } from "../projects/project-discovery";
import { ActiveProjectStore } from "../projects/active-project.store";
import { ProjectRegistry } from "../projects/project-registry";
import { ProjectStateStore } from "../projects/project-state.store";
import { TelegramDiffPreviewStore } from "../telegram/diff-preview/telegram-diff-preview.store";
import { TelegramOutboxStore } from "../telegram/outbox/telegram-outbox.store";
import { TelegramPreferencesStore } from "../telegram/preferences/telegram-preferences.store";
import { TelegramStreamStore } from "../telegram/telegram-stream.store";

const DATA_DIR = "data";
const OVERRIDES_DIR = "overrides";

/* Interval is a trade-off: frequent enough to bound growth, rare enough to avoid IO churn. */
const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;

/* Retention defaults for the outbox file; must stay in sync with store behavior. */
const OUTBOX_MAX_DELIVERED_TO_KEEP = 500;
const OUTBOX_MAX_DEAD_TO_KEEP = 500;
const OUTBOX_MAX_DEAD_AGE_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class DataMaintenanceService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  public constructor(
    @Inject(ConfigToken) private readonly config: AppConfig,
    private readonly events: EventsService,
    private readonly outbox: TelegramOutboxStore,
    private readonly diffPreviews: TelegramDiffPreviewStore,
    private readonly preferences: TelegramPreferencesStore,
    private readonly stream: TelegramStreamStore,
    private readonly active: ActiveProjectStore,
    private readonly state: ProjectStateStore,
    private readonly registry: ProjectRegistry
  ) {}

  public onModuleInit(): void {
    /* Kick off one cleanup on startup and schedule periodic runs. */
    void this.runOnce({ reason: "startup" });

    this.timer = setInterval(() => {
      void this.runOnce({ reason: "interval" });
    }, DEFAULT_INTERVAL_MS);

    /* Allow process to exit even if the interval is still active (important for tests). */
    this.timer.unref?.();
  }

  public onModuleDestroy(): void {
    /* Stop background maintenance loop cleanly. */
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runOnce(input: { reason: "startup" | "interval" }): Promise<void> {
    /* Best-effort: on any failure, emit an event and keep app running. */
    try {
      await this.cleanup();
    } catch (error) {
      this.events.publish({
        type: "maintenance.data.cleanup.error",
        ts: new Date().toISOString(),
        data: {
          reason: input.reason,
          message: error instanceof Error ? error.message : "Data maintenance failed"
        }
      });
    }
  }

  private async cleanup(): Promise<void> {
    /* Ensure `data/` root exists before touching any file stores. */
    const dataRoot = path.join(process.cwd(), DATA_DIR);
    if (!fs.existsSync(dataRoot)) {
      fs.mkdirSync(dataRoot, { recursive: true });
    }

    /* Discover current project slugs from filesystem; used to prune derived caches. */
    const projects = discoverProjects({ projectsRoot: this.config.projectsRoot });
    const allowedSlugs = new Set(projects.map((p) => p.slug));

    /* Prune potentially large stores first to keep disk bounded. */
    this.outbox.prune({
      maxDeliveredToKeep: OUTBOX_MAX_DELIVERED_TO_KEEP,
      maxDeadToKeep: OUTBOX_MAX_DEAD_TO_KEEP,
      maxDeadAgeMs: OUTBOX_MAX_DEAD_AGE_MS
    });
    this.diffPreviews.pruneNow();

    /* Keep per-admin stores bounded to configured admins. */
    this.preferences.pruneToAdmins({ allowedAdminIds: this.config.adminIds });
    this.stream.pruneToAdmins({ allowedAdminIds: this.config.adminIds });

    /* Clear selections/state that reference deleted projects and drop unknown admins. */
    this.active.prune({ allowedAdminIds: this.config.adminIds, allowedSlugs });
    this.state.pruneKnownSlugs({ allowedSlugs });

    /* Remove registry entries that point to deleted folders. */
    await this.registry.pruneMissingRoots({ projectsRoot: this.config.projectsRoot });

    /* Prune generated Traefik override files for deleted projects. */
    this.pruneOverrides({ dataRoot, allowedSlugs });
  }

  private pruneOverrides(input: { dataRoot: string; allowedSlugs: Set<string> }): void {
    /* Overrides are derived artifacts and safe to delete when their slug no longer exists. */
    const dir = path.join(input.dataRoot, OVERRIDES_DIR);
    if (!fs.existsSync(dir)) {
      return;
    }

    for (const name of fs.readdirSync(dir)) {
      /* Only touch files following our naming convention. */
      if (!name.endsWith(".override.yml")) {
        continue;
      }

      const slug = name.replace(/\.override\.yml$/i, "");
      if (input.allowedSlugs.has(slug)) {
        continue;
      }

      const absolutePath = path.join(dir, name);
      try {
        fs.rmSync(absolutePath, { force: true });
      } catch {
        /* Ignore individual file failures; this is best-effort cleanup. */
      }
    }
  }
}
