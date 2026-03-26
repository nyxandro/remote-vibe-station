/**
 * @fileoverview Tests for TelegramPromptQueueService buffering and sequential dispatch.
 *
 * Exports:
 * - createService (L19) - Builds service with explicit test doubles.
 * - describe("TelegramPromptQueueService", L92) - Covers debounce merge, validation and queue ordering.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { TelegramPromptQueueService } from "../telegram-prompt-queue.service";
import { TelegramPromptQueueStore } from "../telegram-prompt-queue.store";
import { TelegramStreamStore } from "../../telegram-stream.store";

const TEST_DATA_DIR = path.join(process.cwd(), "data");
const QUEUE_PATH = path.join(TEST_DATA_DIR, "telegram.prompt-queue.json");

const flushTimers = async (): Promise<void> => {
  /* Run pending timer callbacks and microtasks in deterministic order. */
  jest.runOnlyPendingTimers();
  await Promise.resolve();
  await Promise.resolve();
};

const createService = () => {
  /* Keep dependencies explicit so queue behaviour is isolated and deterministic. */
  const store = new TelegramPromptQueueStore();
  const streamStore = new TelegramStreamStore();
  const promptService = {
    dispatchPromptParts: jest.fn().mockResolvedValue({ sessionId: "session-1", responseText: "ok" })
  };
  const projects = {
    getActiveProject: jest.fn().mockResolvedValue({
      slug: "remote-vibe-station",
      rootPath: "/home/nyx/projects/remote-vibe-station"
    })
  };
  const attachments = {
    materializeAttachments: jest.fn().mockResolvedValue([]),
    deleteFiles: jest.fn().mockResolvedValue(undefined)
  };
  const outbox = {
    enqueueAdminNotification: jest.fn()
  };

  const service = new TelegramPromptQueueService(
    store,
    streamStore,
    promptService as never,
    projects as never,
    attachments as never,
    outbox as never
  );

  return { service, store, streamStore, promptService, projects, attachments, outbox };
};

describe("TelegramPromptQueueService", () => {
  beforeEach(() => {
    /* Reset persisted queue state before every test to avoid cross-test coupling. */
    jest.useFakeTimers();
    fs.rmSync(QUEUE_PATH, { force: true });
  });

  afterEach(() => {
    /* Always restore timers and cleanup generated test data. */
    jest.useRealTimers();
    fs.rmSync(QUEUE_PATH, { force: true });
  });

  it("merges consecutive text chunks into one queued prompt after debounce", async () => {
    /* Telegram long messages may arrive as multiple chunks and must reach agent as one prompt. */
    const { service, promptService, attachments } = createService();

    const first = await service.enqueueIncomingPrompt({ adminId: 7, chatId: 70, text: "Первая часть", messageId: 1 });
    jest.advanceTimersByTime(1_000);
    const second = await service.enqueueIncomingPrompt({ adminId: 7, chatId: 70, text: "Вторая часть", messageId: 2 });
    jest.advanceTimersByTime(2_000);
    await flushTimers();

    expect(first).toEqual(expect.objectContaining({ position: 1, buffered: true, merged: false, queueDepth: 0 }));
    expect(second).toEqual(expect.objectContaining({ position: 1, buffered: true, merged: true, queueDepth: 0 }));
    expect(attachments.materializeAttachments).not.toHaveBeenCalled();
    expect(promptService.dispatchPromptParts).toHaveBeenCalledTimes(1);
    expect(promptService.dispatchPromptParts).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 7,
        projectSlug: "remote-vibe-station",
        directory: "/home/nyx/projects/remote-vibe-station",
        promptTextForTelemetry: "Первая часть\n\nВторая часть",
        parts: [{ type: "text", text: "Первая часть\n\nВторая часть" }]
      })
    );
  });

  it("queues next prompt until current dispatch finishes", async () => {
    /* New messages during active run must wait instead of creating a second session turn immediately. */
    let releaseFirst!: () => void;
    const firstDispatch = new Promise((resolve) => {
      releaseFirst = () => resolve({ sessionId: "session-1", responseText: "ok" });
    });

    const { service, promptService } = createService();
    promptService.dispatchPromptParts
      .mockImplementationOnce(() => firstDispatch)
      .mockResolvedValueOnce({ sessionId: "session-1", responseText: "second" });

    await service.enqueueIncomingPrompt({ adminId: 7, chatId: 70, text: "Первый", messageId: 1 });
    jest.advanceTimersByTime(2_000);
    await flushTimers();
    expect(promptService.dispatchPromptParts).toHaveBeenCalledTimes(1);

    const queued = await service.enqueueIncomingPrompt({ adminId: 7, chatId: 70, text: "Второй", messageId: 2 });
    jest.advanceTimersByTime(2_000);
    await flushTimers();
    expect(promptService.dispatchPromptParts).toHaveBeenCalledTimes(1);
    expect(queued).toEqual(expect.objectContaining({ position: 2, buffered: true, merged: false, queueDepth: 1 }));

    releaseFirst();
    await Promise.resolve();
    await Promise.resolve();

    expect(promptService.dispatchPromptParts).toHaveBeenCalledTimes(2);
    expect(promptService.dispatchPromptParts).toHaveBeenLastCalledWith(
      expect.objectContaining({
        promptTextForTelemetry: "Второй",
        parts: [{ type: "text", text: "Второй" }]
      })
    );
  });

  it("enqueues an internal system prompt immediately for the bound admin chat", async () => {
    /* Backend automation should be able to nudge the same Telegram project queue without waiting for a user message chunk. */
    const { service, streamStore, promptService } = createService();
    streamStore.bindAdminChat(7, 70);

    const result = await service.enqueueSystemPrompt({
      adminId: 7,
      projectSlug: "remote-vibe-station",
      directory: "/home/nyx/projects/remote-vibe-station",
      text: "Продолжай текущую kanban-задачу."
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(result).toEqual({ position: 1 });
    expect(promptService.dispatchPromptParts).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 7,
        projectSlug: "remote-vibe-station",
        directory: "/home/nyx/projects/remote-vibe-station",
        promptTextForTelemetry: "Продолжай текущую kanban-задачу.",
        parts: [{ type: "text", text: "Продолжай текущую kanban-задачу." }]
      })
    );
  });

  it("sends plain photo without caption as file-only prompt", async () => {
    /* Users must be able to send just a photo and let the model infer from visual context alone. */
    const { service, promptService, attachments } = createService();
    attachments.materializeAttachments.mockResolvedValue([
      {
        id: "att-1",
        localPath: "/tmp/telegram/att-1.png",
        promptUrl: "file:///root/.local/share/opencode/telegram-prompt-attachments/att-1.png",
        fileName: "att-1.png",
        mimeType: "image/png",
        fileSizeBytes: 1234
      }
    ]);

    const result = await service.enqueueIncomingPrompt({
      adminId: 7,
      chatId: 70,
      messageId: 1,
      attachments: [
        {
          kind: "photo",
          telegramFileId: "photo-1",
          fileName: "photo.png",
          mimeType: "image/png",
          fileSizeBytes: 1234,
          mediaGroupId: null
        }
      ]
    });
    jest.advanceTimersByTime(2_000);
    await flushTimers();

    expect(result).toEqual(expect.objectContaining({ position: 1, buffered: true, merged: false, queueDepth: 0 }));
    expect(attachments.materializeAttachments).toHaveBeenCalledTimes(1);
    expect(promptService.dispatchPromptParts).toHaveBeenCalledWith(
      expect.objectContaining({
        promptTextForTelemetry: "",
        parts: [
          {
            type: "file",
            mime: "image/png",
            url: "file:///root/.local/share/opencode/telegram-prompt-attachments/att-1.png",
            filename: "att-1.png"
          }
        ]
      })
    );
  });

  it("merges photo caption and later text into one prompt with file", async () => {
    /* A photo caption and the immediate follow-up message should still become one logical request. */
    const { service, promptService, attachments } = createService();
    attachments.materializeAttachments.mockResolvedValue([
      {
        id: "att-1",
        localPath: "/tmp/telegram/att-1.png",
        promptUrl: "file:///root/.local/share/opencode/telegram-prompt-attachments/att-1.png",
        fileName: "att-1.png",
        mimeType: "image/png",
        fileSizeBytes: 1234
      }
    ]);

    await service.enqueueIncomingPrompt({
      adminId: 7,
      chatId: 70,
      messageId: 1,
      text: "Что на картинке?",
      attachments: [
        {
          kind: "photo",
          telegramFileId: "photo-1",
          fileName: "photo.png",
          mimeType: "image/png",
          fileSizeBytes: 1234,
          mediaGroupId: null
        }
      ]
    });
    jest.advanceTimersByTime(1_000);
    await service.enqueueIncomingPrompt({ adminId: 7, chatId: 70, text: "Опиши главное", messageId: 2 });
    jest.advanceTimersByTime(2_000);
    await flushTimers();

    expect(promptService.dispatchPromptParts).toHaveBeenCalledWith(
      expect.objectContaining({
        promptTextForTelemetry: "Что на картинке?\n\nОпиши главное",
        parts: [
          { type: "text", text: "Что на картинке?\n\nОпиши главное" },
          {
            type: "file",
            mime: "image/png",
            url: "file:///root/.local/share/opencode/telegram-prompt-attachments/att-1.png",
            filename: "att-1.png"
          }
        ]
      })
    );
  });

  it("sends PDF documents as file prompt parts", async () => {
    /* PDF uploads should preserve application/pdf MIME so OpenCode receives a real document attachment. */
    const { service, promptService, attachments } = createService();
    attachments.materializeAttachments.mockResolvedValue([
      {
        id: "att-pdf-1",
        localPath: "/tmp/telegram/att-1.pdf",
        promptUrl: "file:///root/.local/share/opencode/telegram-prompt-attachments/att-1.pdf",
        fileName: "att-1.pdf",
        mimeType: "application/pdf",
        fileSizeBytes: 4096
      }
    ]);

    await service.enqueueIncomingPrompt({
      adminId: 7,
      chatId: 70,
      messageId: 3,
      text: "Вытащи требования из PDF",
      attachments: [
        {
          kind: "document",
          telegramFileId: "pdf-1",
          fileName: "requirements.pdf",
          mimeType: "application/pdf",
          fileSizeBytes: 4096,
          mediaGroupId: null
        }
      ]
    });
    jest.advanceTimersByTime(2_000);
    await flushTimers();

    expect(promptService.dispatchPromptParts).toHaveBeenCalledWith(
      expect.objectContaining({
        promptTextForTelemetry: "Вытащи требования из PDF",
        parts: [
          { type: "text", text: "Вытащи требования из PDF" },
          {
            type: "file",
            mime: "application/pdf",
            url: "file:///root/.local/share/opencode/telegram-prompt-attachments/att-1.pdf",
            filename: "att-1.pdf"
          }
        ]
      })
    );
  });

  it("merges album messages from one media group into one prompt with multiple files", async () => {
    /* Telegram media groups should stay together so the agent sees the whole album in one turn. */
    const { service, promptService, attachments } = createService();
    attachments.materializeAttachments.mockResolvedValue([
      {
        id: "att-1",
        localPath: "/tmp/telegram/att-1.png",
        promptUrl: "file:///root/.local/share/opencode/telegram-prompt-attachments/att-1.png",
        fileName: "att-1.png",
        mimeType: "image/png",
        fileSizeBytes: 1234
      },
      {
        id: "att-2",
        localPath: "/tmp/telegram/att-2.png",
        promptUrl: "file:///root/.local/share/opencode/telegram-prompt-attachments/att-2.png",
        fileName: "att-2.png",
        mimeType: "image/png",
        fileSizeBytes: 999
      }
    ]);

    await service.enqueueIncomingPrompt({
      adminId: 7,
      chatId: 70,
      messageId: 1,
      text: "Сравни кадры",
      attachments: [
        {
          kind: "photo",
          telegramFileId: "photo-1",
          fileName: "photo-1.png",
          mimeType: "image/png",
          fileSizeBytes: 1234,
          mediaGroupId: "album-1"
        }
      ]
    });
    jest.advanceTimersByTime(500);
    await service.enqueueIncomingPrompt({
      adminId: 7,
      chatId: 70,
      messageId: 2,
      attachments: [
        {
          kind: "photo",
          telegramFileId: "photo-2",
          fileName: "photo-2.png",
          mimeType: "image/png",
          fileSizeBytes: 999,
          mediaGroupId: "album-1"
        }
      ]
    });
    jest.advanceTimersByTime(2_000);
    await flushTimers();

    expect(promptService.dispatchPromptParts).toHaveBeenCalledWith(
      expect.objectContaining({
        promptTextForTelemetry: "Сравни кадры",
        parts: [
          { type: "text", text: "Сравни кадры" },
          {
            type: "file",
            mime: "image/png",
            url: "file:///root/.local/share/opencode/telegram-prompt-attachments/att-1.png",
            filename: "att-1.png"
          },
          {
            type: "file",
            mime: "image/png",
            url: "file:///root/.local/share/opencode/telegram-prompt-attachments/att-2.png",
            filename: "att-2.png"
          }
        ]
      })
    );
  });
});
