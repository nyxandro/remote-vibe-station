/**
 * @fileoverview Tests for Telegram prompt attachment materialization.
 *
 * Exports:
 * - none (Jest suite for TelegramPromptAttachmentsService).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { TelegramPromptAttachmentsService } from "../telegram-prompt-attachments.service";

describe("TelegramPromptAttachmentsService", () => {
  test("infers application/pdf for downloaded PDF attachments when Telegram omits MIME metadata", async () => {
    /* PDF prompt files should keep document MIME even when Telegram only gives us a .pdf file path. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-telegram-attachments-"));
    const previousCwd = process.cwd();
    const previousFetch = global.fetch;
    process.chdir(tmp);

    try {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ok: true, result: { file_path: "documents/report.pdf" } })
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer
        });
      global.fetch = fetchMock as unknown as typeof fetch;

      const service = new TelegramPromptAttachmentsService({
        telegramBotToken: "test-token",
        opencodeDataDir: path.join(tmp, "opencode-data")
      } as never);

      const [attachment] = await service.materializeAttachments({
        attachments: [
          {
            kind: "document",
            telegramFileId: "pdf-1",
            fileName: null,
            mimeType: null,
            fileSizeBytes: null,
            mediaGroupId: null
          }
        ]
      });

      expect(attachment.fileName).toMatch(/\.pdf$/);
      expect(attachment.mimeType).toBe("application/pdf");
      expect(attachment.promptUrl.startsWith("file:///")).toBe(true);
      expect(attachment.promptUrl).toContain("telegram-prompt-attachments/");
      expect(attachment.promptUrl).toMatch(/\.pdf$/);
      expect(fs.existsSync(attachment.localPath)).toBe(true);
    } finally {
      global.fetch = previousFetch;
      process.chdir(previousCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
