/**
 * @fileoverview Tests for Telegram agent media staging, targeting, and cleanup.
 *
 * Exports:
 * - none (Jest suite for TelegramAgentMediaService and storage integration).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TelegramStreamStore } from "../../telegram-stream.store";
import { TelegramOutboxStore } from "../../outbox/telegram-outbox.store";
import { OpenCodeSessionRoutingStore } from "../../../open-code/opencode-session-routing.store";
import { TelegramAgentMediaService } from "../telegram-agent-media.service";
import { TelegramAgentMediaStorageService } from "../telegram-agent-media-storage.service";

const readOutboxItems = (cwd: string): any[] => {
  const outboxPath = path.join(cwd, "data", "telegram.outbox.json");
  if (!fs.existsSync(outboxPath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(outboxPath, "utf8")).items ?? [];
};

const writeFile = (filePath: string, value: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
};

describe("TelegramAgentMediaService", () => {
  test("enqueues document delivery back to the Telegram chat bound to the current session", async () => {
    /* Media replies must route strictly through the current Telegram-owned OpenCode session. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-agent-media-"));
    const previousCwd = process.cwd();
    process.chdir(tmp);

    try {
      const opencodeDataDir = path.join(tmp, "opencode-data");
      const config = {
        adminIds: [101],
        opencodeDataDir
      } as any;
      const sessionRouting = new OpenCodeSessionRoutingStore();
      const stream = new TelegramStreamStore();
      stream.bindAdminChat(101, 555001);
      sessionRouting.bind("ses_telegram_1", { adminId: 101, directory: "/srv/projects/auto-v-arendu" });

      const storage = new TelegramAgentMediaStorageService(config);
      const stagedPath = path.join(storage.getOutgoingRoot(), "artifact.pdf");
      writeFile(stagedPath, "pdf-bytes");

      const projects = { getActiveProject: jest.fn() };
      const opencode = { getSelectedSessionID: jest.fn() };

      const service = new TelegramAgentMediaService(
        config,
        sessionRouting,
        projects as never,
        opencode as never,
        stream,
        new TelegramOutboxStore(),
        storage
      );
      const queued = await service.sendMedia({
        sessionId: "ses_telegram_1",
        stagedRelativePath: "artifact.pdf",
        sendAs: "document",
        caption: "Смотри PDF"
      });

      expect(queued.adminId).toBe(101);
      expect(queued.chatId).toBe(555001);

      const items = readOutboxItems(tmp);
      expect(items).toHaveLength(1);
      expect(items[0].kind).toBe("media");
      expect(items[0].media).toMatchObject({
        kind: "document",
        caption: "Смотри PDF",
        fileName: "artifact.pdf",
        filePath: stagedPath
      });
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("rejects sends from sessions that are not bound to Telegram admin context", async () => {
    /* The agent must never guess a recipient outside the current Telegram-authenticated session. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-agent-media-"));
    const previousCwd = process.cwd();
    process.chdir(tmp);

    try {
      const opencodeDataDir = path.join(tmp, "opencode-data");
      const config = {
        adminIds: [101, 202],
        opencodeDataDir
      } as any;
      const sessionRouting = new OpenCodeSessionRoutingStore();
      const stream = new TelegramStreamStore();
      stream.bindAdminChat(101, 555001);
      stream.bindAdminChat(202, 555002);

      const storage = new TelegramAgentMediaStorageService(config);
      writeFile(path.join(storage.getOutgoingRoot(), "screen.png"), "png-bytes");

      const projects = { getActiveProject: jest.fn().mockResolvedValue(null) };
      const opencode = { getSelectedSessionID: jest.fn().mockReturnValue(null) };

      const service = new TelegramAgentMediaService(
        config,
        sessionRouting,
        projects as never,
        opencode as never,
        stream,
        new TelegramOutboxStore(),
        storage
      );
      await expect(
        service.sendMedia({
          sessionId: "ses_missing",
          stagedRelativePath: "screen.png",
          sendAs: "photo"
        })
      ).rejects.toThrow(/TG_MEDIA_SESSION_UNBOUND/);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("rejects non-image files in albums", async () => {
    /* Telegram albums are photo-only for this tool contract, so mixed file types must be rejected. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-agent-media-"));
    const previousCwd = process.cwd();
    process.chdir(tmp);

    try {
      const opencodeDataDir = path.join(tmp, "opencode-data");
      const config = {
        adminIds: [101],
        opencodeDataDir
      } as any;
      const sessionRouting = new OpenCodeSessionRoutingStore();
      const stream = new TelegramStreamStore();
      stream.bindAdminChat(101, 555001);
      sessionRouting.bind("ses_telegram_album", { adminId: 101, directory: "/srv/projects/auto-v-arendu" });

      const storage = new TelegramAgentMediaStorageService(config);
      writeFile(path.join(storage.getOutgoingRoot(), "screen.png"), "png-bytes");
      writeFile(path.join(storage.getOutgoingRoot(), "notes.txt"), "plain-text");

      const projects = { getActiveProject: jest.fn() };
      const opencode = { getSelectedSessionID: jest.fn() };

      const service = new TelegramAgentMediaService(
        config,
        sessionRouting,
        projects as never,
        opencode as never,
        stream,
        new TelegramOutboxStore(),
        storage
      );
      await expect(
        service.sendAlbum({
          sessionId: "ses_telegram_album",
          items: [{ stagedRelativePath: "screen.png" }, { stagedRelativePath: "notes.txt" }]
        })
      ).rejects.toThrow(/TG_MEDIA_NOT_IMAGE/);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("cleanup removes old delivered files but keeps pending ones", () => {
    /* The shared exchange folder must not grow forever, but active pending sends must stay intact. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-agent-media-"));
    const previousCwd = process.cwd();
    process.chdir(tmp);

    try {
      const opencodeDataDir = path.join(tmp, "opencode-data");
      const config = {
        adminIds: [101],
        opencodeDataDir
      } as any;
      const sessionRouting = new OpenCodeSessionRoutingStore();
      const storage = new TelegramAgentMediaStorageService(config);
      const outgoingRoot = storage.getOutgoingRoot();
      const oldDelivered = path.join(outgoingRoot, "delivered.png");
      const pendingFile = path.join(outgoingRoot, "pending.png");
      const orphanFile = path.join(outgoingRoot, "orphan.png");

      writeFile(oldDelivered, "old");
      writeFile(pendingFile, "pending");
      writeFile(orphanFile, "orphan");

      const oldTimestamp = Date.parse("2026-03-01T00:00:00.000Z");
      fs.utimesSync(oldDelivered, oldTimestamp / 1000, oldTimestamp / 1000);
      fs.utimesSync(orphanFile, oldTimestamp / 1000, oldTimestamp / 1000);

      storage.pruneExpiredFiles({
        nowMs: Date.parse("2026-03-03T00:30:00.000Z"),
        outboxItems: [
          {
            id: "delivered-1",
            adminId: 101,
            chatId: 555001,
            text: "",
            kind: "media",
            media: {
              kind: "photo",
              filePath: oldDelivered,
              fileName: "delivered.png"
            },
            createdAt: "2026-03-01T00:00:00.000Z",
            status: "delivered",
            attempts: 0,
            nextAttemptAt: "2026-03-01T00:00:00.000Z",
            deliveredAt: "2026-03-01T00:00:00.000Z"
          },
          {
            id: "pending-1",
            adminId: 101,
            chatId: 555001,
            text: "",
            kind: "media",
            media: {
              kind: "photo",
              filePath: pendingFile,
              fileName: "pending.png"
            },
            createdAt: "2026-03-03T00:00:00.000Z",
            status: "pending",
            attempts: 0,
            nextAttemptAt: "2026-03-03T00:00:00.000Z"
          }
        ] as any
      });

      expect(fs.existsSync(oldDelivered)).toBe(false);
      expect(fs.existsSync(pendingFile)).toBe(true);
      expect(fs.existsSync(orphanFile)).toBe(false);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("rejects sessions whose admin is no longer an allowed Telegram admin", async () => {
    /* Stale session routes must not bypass the configured admin allowlist. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-agent-media-"));
    const previousCwd = process.cwd();
    process.chdir(tmp);

    try {
      const opencodeDataDir = path.join(tmp, "opencode-data");
      const config = {
        adminIds: [101],
        opencodeDataDir
      } as any;
      const sessionRouting = new OpenCodeSessionRoutingStore();
      const stream = new TelegramStreamStore();
      stream.bindAdminChat(999, 555999);
      sessionRouting.bind("ses_stale_admin", { adminId: 999, directory: "/srv/projects/auto-v-arendu" });

      const storage = new TelegramAgentMediaStorageService(config);
      writeFile(path.join(storage.getOutgoingRoot(), "screen.png"), "png-bytes");

      const projects = { getActiveProject: jest.fn() };
      const opencode = { getSelectedSessionID: jest.fn() };

      const service = new TelegramAgentMediaService(
        config,
        sessionRouting,
        projects as never,
        opencode as never,
        stream,
        new TelegramOutboxStore(),
        storage
      );
      await expect(
        service.sendMedia({
          sessionId: "ses_stale_admin",
          stagedRelativePath: "screen.png",
          sendAs: "photo"
        })
      ).rejects.toThrow(/TG_MEDIA_ADMIN_UNKNOWN/);
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("recovers session routing from the exact currently selected Telegram session after backend restart", async () => {
    /* Backend restart should not break media sends when the active Telegram session is still selected in OpenCode. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-agent-media-"));
    const previousCwd = process.cwd();
    process.chdir(tmp);

    try {
      const opencodeDataDir = path.join(tmp, "opencode-data");
      const config = {
        adminIds: [101],
        opencodeDataDir
      } as any;
      const sessionRouting = new OpenCodeSessionRoutingStore();
      const stream = new TelegramStreamStore();
      stream.bindAdminChat(101, 555001);

      const projects = {
        getActiveProject: jest.fn().mockResolvedValue({ slug: "auto-v-arendu", rootPath: "/srv/projects/auto-v-arendu" })
      };
      const opencode = {
        getSelectedSessionID: jest.fn().mockReturnValue("ses_recoverable"),
        listSessions: jest.fn().mockResolvedValue([])
      };

      const storage = new TelegramAgentMediaStorageService(config);
      writeFile(path.join(storage.getOutgoingRoot(), "screen.png"), "png-bytes");

      const service = new TelegramAgentMediaService(
        config,
        sessionRouting,
        projects as never,
        opencode as never,
        stream,
        new TelegramOutboxStore(),
        storage
      );

      const queued = await service.sendMedia({
        sessionId: "ses_recoverable",
        stagedRelativePath: "screen.png",
        sendAs: "photo"
      });

      expect(queued).toMatchObject({ adminId: 101, chatId: 555001 });
      expect(sessionRouting.resolve("ses_recoverable")).toEqual({
        adminId: 101,
        directory: "/srv/projects/auto-v-arendu"
      });
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("recovers session routing from active project session list when selected-session cache is empty", async () => {
    /* Backend restart can lose selected-session cache, so recovery should fall back to the active project's session list. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-agent-media-"));
    const previousCwd = process.cwd();
    process.chdir(tmp);

    try {
      const opencodeDataDir = path.join(tmp, "opencode-data");
      const config = {
        adminIds: [101],
        opencodeDataDir
      } as any;
      const sessionRouting = new OpenCodeSessionRoutingStore();
      const stream = new TelegramStreamStore();
      stream.bindAdminChat(101, 555001);

      const projects = {
        getActiveProject: jest.fn().mockResolvedValue({ slug: "auto-v-arendu", rootPath: "/srv/projects/auto-v-arendu" }),
        list: jest.fn().mockResolvedValue([])
      };
      const opencode = {
        getSelectedSessionID: jest.fn().mockReturnValue(null),
        listSessions: jest.fn().mockResolvedValue([{ id: "ses_from_list", title: "Recovered", status: "idle", updatedAt: null }])
      };

      const storage = new TelegramAgentMediaStorageService(config);
      writeFile(path.join(storage.getOutgoingRoot(), "screen.png"), "png-bytes");

      const service = new TelegramAgentMediaService(
        config,
        sessionRouting,
        projects as never,
        opencode as never,
        stream,
        new TelegramOutboxStore(),
        storage
      );

      const queued = await service.sendMedia({
        sessionId: "ses_from_list",
        stagedRelativePath: "screen.png",
        sendAs: "photo"
      });

      expect(queued).toMatchObject({ adminId: 101, chatId: 555001 });
      expect(opencode.listSessions).toHaveBeenCalledWith({ directory: "/srv/projects/auto-v-arendu", limit: 50 });
      expect(sessionRouting.resolve("ses_from_list")).toEqual({
        adminId: 101,
        directory: "/srv/projects/auto-v-arendu"
      });
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("recovers session routing from any discovered project when only one admin exists", async () => {
    /* Single-admin runtime should still recover media delivery after active project drift or restart. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-agent-media-"));
    const previousCwd = process.cwd();
    process.chdir(tmp);

    try {
      const opencodeDataDir = path.join(tmp, "opencode-data");
      const config = {
        adminIds: [101],
        opencodeDataDir
      } as any;
      const sessionRouting = new OpenCodeSessionRoutingStore();
      const stream = new TelegramStreamStore();
      stream.bindAdminChat(101, 555001);

      const projects = {
        getActiveProject: jest.fn().mockResolvedValue(null),
        list: jest.fn().mockResolvedValue([
          { slug: "aihub", rootPath: "/srv/projects/aihub" },
          { slug: "auto-v-arendu", rootPath: "/srv/projects/auto-v-arendu" }
        ])
      };
      const opencode = {
        getSelectedSessionID: jest.fn().mockReturnValue(null),
        listSessions: jest
          .fn()
          .mockResolvedValueOnce([{ id: "ses_other", title: "Other", status: "idle", updatedAt: null }])
          .mockResolvedValueOnce([{ id: "ses_from_discovery", title: "Recovered", status: "idle", updatedAt: null }])
      };

      const storage = new TelegramAgentMediaStorageService(config);
      writeFile(path.join(storage.getOutgoingRoot(), "screen.png"), "png-bytes");

      const service = new TelegramAgentMediaService(
        config,
        sessionRouting,
        projects as never,
        opencode as never,
        stream,
        new TelegramOutboxStore(),
        storage
      );

      const queued = await service.sendMedia({
        sessionId: "ses_from_discovery",
        stagedRelativePath: "screen.png",
        sendAs: "photo"
      });

      expect(queued).toMatchObject({ adminId: 101, chatId: 555001 });
      expect(projects.list).toHaveBeenCalled();
      expect(sessionRouting.resolve("ses_from_discovery")).toEqual({
        adminId: 101,
        directory: "/srv/projects/auto-v-arendu"
      });
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
