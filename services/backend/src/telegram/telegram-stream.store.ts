/**
 * @fileoverview Persistent mapping of Telegram chats to stream settings.
 *
 * Exports:
 * - TelegramStreamStore (L24) - Stores last chatId per admin and stream enabled flag.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";

const DATA_DIR = "data";
const FILE_NAME = "telegram.stream.json";

type StreamRecord = {
  chatId: number;
  streamEnabled: boolean;
  updatedAt: string;
};

type StreamFile = {
  byAdminId: Record<string, StreamRecord>;
};

@Injectable()
export class TelegramStreamStore {
  private readonly filePath: string;

  public constructor() {
    /* Persist in backend data volume; safe across restarts. */
    this.filePath = path.join(process.cwd(), DATA_DIR, FILE_NAME);
  }

  public bindAdminChat(adminId: number, chatId: number): StreamRecord {
    /* Remember the last chat where the admin interacted with the bot. */
    const file = this.readAll();
    const key = String(adminId);

    const next: StreamRecord = {
      chatId,
      streamEnabled: file.byAdminId[key]?.streamEnabled ?? false,
      updatedAt: new Date().toISOString()
    };

    file.byAdminId[key] = next;
    this.writeAll(file);
    return next;
  }

  public setStreamEnabled(adminId: number, enabled: boolean): StreamRecord {
    /* Enable/disable stream for the admin's last known chat. */
    const file = this.readAll();
    const key = String(adminId);
    const existing = file.byAdminId[key];

    if (!existing) {
      throw new Error(`Chat binding not found for admin: ${adminId}`);
    }

    const next: StreamRecord = {
      ...existing,
      streamEnabled: enabled,
      updatedAt: new Date().toISOString()
    };

    file.byAdminId[key] = next;
    this.writeAll(file);
    return next;
  }

  public get(adminId: number): StreamRecord | null {
    /* Return binding record for admin, if present. */
    const file = this.readAll();
    return file.byAdminId[String(adminId)] ?? null;
  }

  public pruneToAdmins(input: { allowedAdminIds: number[] }): { before: number; after: number; removed: number } {
    /*
     * Keep only configured admins to avoid slow growth if admin ids change over time.
     * The stream store is small, but this makes retention policy explicit.
     */
    const file = this.readAll();
    const before = Object.keys(file.byAdminId).length;

    const allowed = new Set(input.allowedAdminIds.map((id) => String(id)));
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

  private readAll(): StreamFile {
    /* Ensure data directory exists. */
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.filePath)) {
      return { byAdminId: {} };
    }

    return JSON.parse(fs.readFileSync(this.filePath, "utf-8")) as StreamFile;
  }

  private writeAll(file: StreamFile): void {
    /* Persist stable JSON for manual debugging. */
    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), "utf-8");
  }
}
