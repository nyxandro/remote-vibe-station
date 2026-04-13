/**
 * @fileoverview Types for Telegram prompt buffering and queued dispatch.
 *
 * Exports:
 * - TelegramBufferedAttachment (L10) - Attachment reference kept before Telegram file download.
 * - TelegramPromptBuffer (L21) - Debounced logical prompt assembled from multiple Telegram messages.
 * - TelegramQueuedAttachment (L34) - Persisted local file prepared for OpenCode prompt parts.
 * - TelegramPromptQueueItem (L43) - Queue item dispatched to OpenCode sequentially per project.
 * - TelegramPromptQueueFile (L58) - JSON store shape for buffers and queue items.
 */

export type TelegramBufferedAttachment = {
  kind: "photo" | "document";
  telegramFileId: string;
  fileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  mediaGroupId: string | null;
};

export type TelegramPromptBuffer = {
  id: string;
  key: string;
  adminId: number;
  chatId: number;
  directory: string;
  projectSlug: string;
  textSegments: string[];
  attachments: TelegramBufferedAttachment[];
  sourceMessageIds: number[];
  createdAt: string;
  updatedAt: string;
  flushAt: string;
  mergeMode: "plain_text" | "attachment_context";
};

export type TelegramQueuedAttachment = {
  id: string;
  localPath: string;
  promptUrl: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number | null;
};

export type TelegramPromptQueueItem = {
  id: string;
  key: string;
  adminId: number;
  chatId: number;
  directory: string;
  projectSlug: string;
  text: string;
  attachments: TelegramQueuedAttachment[];
  sourceMessageIds: number[];
  createdAt: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
};

export type TelegramPromptQueueFile = {
  buffers: TelegramPromptBuffer[];
  items: TelegramPromptQueueItem[];
};
