/**
 * @fileoverview Self-heals installed runtime compose files with required shared toolbox persistence.
 *
 * Exports:
 * - RuntimeComposeSyncResult - Sync result for startup logs/tests.
 * - RuntimeComposeSyncService - Ensures legacy runtime installs keep `/toolbox` mounted.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable, OnModuleInit } from "@nestjs/common";

const RUNTIME_CONFIG_DIR_ENV = "RUNTIME_CONFIG_DIR";
const PRIMARY_COMPOSE_FILE = "docker-compose.yml";
const OPENCODE_TOOLBOX_MOUNT = "      - toolbox_data:/toolbox";
const OPENCODE_CONFIG_MOUNT = "      - opencode_config:/root/.config/opencode";
const OPENCODE_LABELS_HEADER = "    labels:";
const ROOT_VOLUMES_HEADER = "volumes:";
const TOOLBOX_VOLUME_DECLARATION = "  toolbox_data:";
const WRITE_RETRY_ATTEMPTS = 3;

export type RuntimeComposeSyncResult = {
  composePath: string | null;
  updated: boolean;
  skippedReason: string | null;
};

@Injectable()
export class RuntimeComposeSyncService implements OnModuleInit {
  public onModuleInit(): void {
    /* Old server installs may keep stale compose templates, so patch them opportunistically at startup. */
    void this.sync().catch(() => undefined);
  }

  public async sync(input?: { runtimeConfigDir?: string | null }): Promise<RuntimeComposeSyncResult> {
    /* Keep runtime dir resolution explicit so tests can bypass process env and startup can use the real mount. */
    const runtimeConfigDir = input?.runtimeConfigDir?.trim() || process.env[RUNTIME_CONFIG_DIR_ENV]?.trim() || "";
    if (!runtimeConfigDir) {
      return { composePath: null, updated: false, skippedReason: "RUNTIME_CONFIG_DIR is not configured" };
    }

    const composePath = path.join(runtimeConfigDir, PRIMARY_COMPOSE_FILE);
    /* Retry read-modify-write so overlapping backend startups do not clobber each other with stale content. */
    for (let attempt = 1; attempt <= WRITE_RETRY_ATTEMPTS; attempt += 1) {
      const compose = await this.readComposeFile(composePath);
      if (typeof compose !== "string") {
        return compose;
      }

      /* Keep startup idempotent and cheap when runtime already matches the expected toolbox layout. */
      if (compose.includes(OPENCODE_TOOLBOX_MOUNT) && compose.includes(`\n${TOOLBOX_VOLUME_DECLARATION}\n`)) {
        return { composePath, updated: false, skippedReason: null };
      }

      const patchedMounts = this.ensureToolboxMount(compose);
      const patchedCompose = this.ensureToolboxVolumeDeclaration(patchedMounts);
      if (patchedCompose === compose) {
        return { composePath, updated: false, skippedReason: null };
      }

      if (await this.tryAtomicWrite(composePath, compose, patchedCompose)) {
        return { composePath, updated: true, skippedReason: null };
      }
    }

    return {
      composePath,
      updated: false,
      skippedReason:
        "APP_RUNTIME_COMPOSE_CONCURRENT_UPDATE: runtime compose changed during toolbox sync; retry after concurrent startup activity settles"
    };
  }

  private ensureToolboxMount(compose: string): string {
    /* Insert the shared toolbox mount next to the existing persisted OpenCode config mounts. */
    if (compose.includes(OPENCODE_TOOLBOX_MOUNT)) {
      return compose;
    }

    if (compose.includes(`${OPENCODE_CONFIG_MOUNT}\n${OPENCODE_LABELS_HEADER}`)) {
      return compose.replace(
        `${OPENCODE_CONFIG_MOUNT}\n${OPENCODE_LABELS_HEADER}`,
        `${OPENCODE_CONFIG_MOUNT}\n${OPENCODE_TOOLBOX_MOUNT}\n${OPENCODE_LABELS_HEADER}`
      );
    }

    throw new Error(
      "APP_RUNTIME_COMPOSE_PATCH_FAILED: cannot insert toolbox mount because expected opencode volume anchor is missing"
    );
  }

  private ensureToolboxVolumeDeclaration(compose: string): string {
    /* Keep the named volume declared at root level so compose recreates the shared toolbox storage after updates. */
    if (compose.includes(`\n${TOOLBOX_VOLUME_DECLARATION}\n`)) {
      return compose;
    }

    const volumesIndex = compose.lastIndexOf(`\n${ROOT_VOLUMES_HEADER}\n`);
    if (volumesIndex === -1) {
      throw new Error(
        "APP_RUNTIME_COMPOSE_PATCH_FAILED: cannot declare toolbox volume because root volumes section is missing"
      );
    }

    const cliproxyIndex = compose.indexOf("\n  cliproxy_auth:", volumesIndex);
    if (cliproxyIndex !== -1) {
      return `${compose.slice(0, cliproxyIndex)}\n${TOOLBOX_VOLUME_DECLARATION}${compose.slice(cliproxyIndex)}`;
    }

    return `${compose.trimEnd()}\n${TOOLBOX_VOLUME_DECLARATION}\n`;
  }

  private async readComposeFile(composePath: string): Promise<string | RuntimeComposeSyncResult> {
    /* Missing compose file is non-fatal because local/dev environments do not always mount runtime config. */
    try {
      return await fs.readFile(composePath, "utf-8");
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown read error";
      return {
        composePath,
        updated: false,
        skippedReason: `APP_RUNTIME_COMPOSE_NOT_FOUND: cannot read runtime compose: ${message}`
      };
    }
  }

  private async tryAtomicWrite(composePath: string, expected: string, next: string): Promise<boolean> {
    /* Re-check the source content right before rename so concurrent startups never overwrite a fresher patch. */
    const current = await fs.readFile(composePath, "utf-8");
    if (current !== expected) {
      return false;
    }

    const tempPath = `${composePath}.toolbox-sync.${process.pid}.${Date.now()}`;
    await fs.writeFile(tempPath, next, "utf-8");

    try {
      const latest = await fs.readFile(composePath, "utf-8");
      if (latest !== expected) {
        return false;
      }

      await fs.rename(tempPath, composePath);
      return true;
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}
