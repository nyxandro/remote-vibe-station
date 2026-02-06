/**
 * @fileoverview Persistent store for Mini App diff-preview tokens.
 *
 * Exports:
 * - DiffPreviewRecord (L23) - Stored diff preview payload.
 * - TelegramDiffPreviewStore (L49) - Create/get tokenized diff previews.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";

const DATA_DIR = "data";
const FILE_NAME = "telegram.diff-previews.json";
const MAX_RECORDS = 2000;
const TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type DiffPreviewRecord = {
  token: string;
  adminId: number;
  operation: "create" | "edit" | "delete";
  absolutePath: string;
  additions: number;
  deletions: number;
  diff: string;
  before?: string;
  after?: string;
  createdAt: string;
};

type StoreFile = {
  items: DiffPreviewRecord[];
};

const parseIsoMs = (value: string | undefined): number => {
  /* Invalid timestamps are treated as stale. */
  if (!value) {
    return 0;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

@Injectable()
export class TelegramDiffPreviewStore {
  private readonly filePath: string;

  public constructor() {
    /* Keep store under backend mounted data volume. */
    this.filePath = path.join(process.cwd(), DATA_DIR, FILE_NAME);
  }

  public create(input: Omit<DiffPreviewRecord, "token" | "createdAt">): DiffPreviewRecord {
    /* Persist new preview token and prune stale/overflow records. */
    const file = this.readAll();
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const token = crypto.randomBytes(12).toString("base64url");
    const record: DiffPreviewRecord = {
      token,
      createdAt: nowIso,
      ...input
    };

    file.items.push(record);
    this.prune(file, nowMs);
    this.writeAll(file);
    return record;
  }

  public get(token: string): DiffPreviewRecord | null {
    /* Read by token and refresh storage cleanup as a side effect. */
    const file = this.readAll();
    const nowMs = Date.now();
    this.prune(file, nowMs);
    this.writeAll(file);

    return file.items.find((item) => item.token === token) ?? null;
  }

  private prune(file: StoreFile, nowMs: number): void {
    /* Drop stale entries and cap file size for long-running deployments. */
    file.items = file.items.filter((item) => nowMs - parseIsoMs(item.createdAt) <= TTL_MS);
    if (file.items.length <= MAX_RECORDS) {
      return;
    }

    file.items = file.items
      .slice()
      .sort((a, b) => parseIsoMs(a.createdAt) - parseIsoMs(b.createdAt))
      .slice(file.items.length - MAX_RECORDS);
  }

  private readAll(): StoreFile {
    /* Initialize directory/file lazily for first start. */
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.filePath)) {
      return { items: [] };
    }

    const raw = fs.readFileSync(this.filePath, "utf-8");
    try {
      const parsed = JSON.parse(raw) as StoreFile;
      return parsed && Array.isArray(parsed.items) ? parsed : { items: [] };
    } catch {
      return { items: [] };
    }
  }

  private writeAll(file: StoreFile): void {
    /* Persist pretty JSON for easier manual debugging. */
    fs.writeFileSync(this.filePath, JSON.stringify(file, null, 2), "utf-8");
  }
}
