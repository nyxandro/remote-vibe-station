/**
 * @fileoverview Tests for periodic retention of backend `data/` stores.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { EventsService } from "../../events/events.service";
import { ActiveProjectStore } from "../../projects/active-project.store";
import { ProjectRegistry } from "../../projects/project-registry";
import { ProjectStateStore } from "../../projects/project-state.store";
import { TelegramDiffPreviewStore } from "../../telegram/diff-preview/telegram-diff-preview.store";
import { TelegramOutboxStore } from "../../telegram/outbox/telegram-outbox.store";
import { TelegramPreferencesStore } from "../../telegram/preferences/telegram-preferences.store";
import { TelegramStreamStore } from "../../telegram/telegram-stream.store";
import { DataMaintenanceService } from "../data-maintenance.service";

const writeJson = (absolutePath: string, value: unknown): void => {
  /* Helper for stable test fixtures. */
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(value, null, 2), "utf-8");
};

describe("DataMaintenanceService", () => {
  test("prunes stale admin entries, stale slugs, missing registry roots, and override files", async () => {
    /* Isolate cwd so stores write under a temporary folder. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-maint-"));
    const prev = process.cwd();
    process.chdir(tmp);

    try {
      /* Prepare a fake projects root for discovery-based pruning. */
      const projectsRoot = path.join(tmp, "projects");
      fs.mkdirSync(path.join(projectsRoot, "keep-1"), { recursive: true });

      /* Prepare data folder with all supported files. */
      const dataRoot = path.join(tmp, "data");
      fs.mkdirSync(dataRoot, { recursive: true });

      writeJson(path.join(dataRoot, "telegram.preferences.json"), {
        byAdminId: {
          "1": { modelId: "m" },
          "999": { modelId: "x" }
        }
      });

      writeJson(path.join(dataRoot, "telegram.stream.json"), {
        byAdminId: {
          "1": { chatId: 100, streamEnabled: true, updatedAt: "2026-02-01T00:00:00.000Z" },
          "999": { chatId: 999, streamEnabled: false, updatedAt: "2026-02-01T00:00:00.000Z" }
        }
      });

      writeJson(path.join(dataRoot, "active-project.json"), {
        byAdminId: {
          "1": { slug: "deleted", updatedAt: "2026-02-01T00:00:00.000Z" },
          "999": { slug: "keep-1", updatedAt: "2026-02-01T00:00:00.000Z" }
        },
        global: { slug: "deleted", updatedAt: "2026-02-01T00:00:00.000Z" }
      });

      writeJson(path.join(dataRoot, "projects.state.json"), {
        "keep-1": { status: "running" },
        deleted: { status: "stopped" }
      });

      /* Registry has a stale record pointing to a missing root. */
      writeJson(path.join(dataRoot, "projects.json"), [
        {
          id: "a",
          name: "keep-1",
          slug: "keep-1",
          rootPath: path.join(projectsRoot, "keep-1"),
          composePath: path.join(projectsRoot, "keep-1", "docker-compose.yml"),
          serviceName: "svc",
          servicePort: 3000,
          domain: "keep-1.example.com",
          status: "unknown"
        },
        {
          id: "b",
          name: "deleted",
          slug: "deleted",
          rootPath: path.join(projectsRoot, "deleted"),
          composePath: path.join(projectsRoot, "deleted", "docker-compose.yml"),
          serviceName: "svc",
          servicePort: 3000,
          domain: "deleted.example.com",
          status: "unknown"
        }
      ]);

      /* Override artifacts: keep one, remove one. */
      const overridesDir = path.join(dataRoot, "overrides");
      fs.mkdirSync(overridesDir, { recursive: true });
      fs.writeFileSync(path.join(overridesDir, "keep-1.override.yml"), "services: {}\n", "utf-8");
      fs.writeFileSync(path.join(overridesDir, "deleted.override.yml"), "services: {}\n", "utf-8");

      /* Diff previews: keep one fresh record, drop one stale record. */
      writeJson(path.join(dataRoot, "telegram.diff-previews.json"), {
        items: [
          {
            token: "old",
            adminId: 1,
            operation: "edit",
            absolutePath: "/x",
            additions: 1,
            deletions: 1,
            diff: "-a\n+b\n",
            createdAt: "2000-01-01T00:00:00.000Z"
          },
          {
            token: "new",
            adminId: 1,
            operation: "edit",
            absolutePath: "/y",
            additions: 1,
            deletions: 1,
            diff: "-a\n+b\n",
            createdAt: new Date().toISOString()
          }
        ]
      });

      /* Outbox file must exist for the cleanup call; content is not asserted here. */
      writeJson(path.join(dataRoot, "telegram.outbox.json"), { items: [] });

      /* Wire service with real stores (file-based), but call cleanup directly. */
      const config = {
        telegramBotToken: "x",
        adminIds: [1],
        publicBaseUrl: "http://localhost",
        publicDomain: "example.com",
        projectsRoot,
        opencodeSyncOnStart: false,
        opencodeWarmRecentsOnStart: false,
        opencodeWarmRecentsLimit: 0,
        opencodeServerUrl: "http://localhost",
        eventBufferSize: 10
      };

      const events = new EventsService(config as any);
      const service = new DataMaintenanceService(
        config as any,
        events,
        new TelegramOutboxStore(),
        new TelegramDiffPreviewStore(),
        new TelegramPreferencesStore(),
        new TelegramStreamStore(),
        new ActiveProjectStore(),
        new ProjectStateStore(),
        new ProjectRegistry()
      );

      await (service as any).cleanup();

      /* Preferences prunes unknown admins. */
      const prefs = JSON.parse(fs.readFileSync(path.join(dataRoot, "telegram.preferences.json"), "utf-8"));
      expect(Object.keys(prefs.byAdminId)).toEqual(["1"]);

      /* Stream store prunes unknown admins. */
      const stream = JSON.parse(fs.readFileSync(path.join(dataRoot, "telegram.stream.json"), "utf-8"));
      expect(Object.keys(stream.byAdminId)).toEqual(["1"]);

      /* Active project clears unknown slugs and prunes unknown admins. */
      const active = JSON.parse(fs.readFileSync(path.join(dataRoot, "active-project.json"), "utf-8"));
      expect(Object.keys(active.byAdminId)).toEqual(["1"]);
      expect(active.byAdminId["1"].slug).toBeNull();
      expect(active.global.slug).toBeNull();

      /* Project state store drops unknown slugs. */
      const state = JSON.parse(fs.readFileSync(path.join(dataRoot, "projects.state.json"), "utf-8"));
      expect(Object.keys(state)).toEqual(["keep-1"]);

      /* Registry drops records for missing folders. */
      const reg = JSON.parse(fs.readFileSync(path.join(dataRoot, "projects.json"), "utf-8"));
      expect(reg).toHaveLength(1);
      expect(reg[0].slug).toBe("keep-1");

      /* Overrides drop stale slug files. */
      expect(fs.existsSync(path.join(overridesDir, "keep-1.override.yml"))).toBe(true);
      expect(fs.existsSync(path.join(overridesDir, "deleted.override.yml"))).toBe(false);

      /* Diff previews prune stale records. */
      const diffPreviews = JSON.parse(
        fs.readFileSync(path.join(dataRoot, "telegram.diff-previews.json"), "utf-8")
      );
      expect(diffPreviews.items.map((i: any) => i.token)).toEqual(["new"]);
    } finally {
      process.chdir(prev);
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });
});
