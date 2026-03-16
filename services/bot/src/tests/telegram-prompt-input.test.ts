/**
 * @fileoverview Tests for Telegram prompt payload extraction helpers.
 *
 * Exports:
 * - (none)
 */

import {
  buildTelegramPromptEnqueueBody,
  extractTelegramImageDocumentInput,
  extractTelegramPhotoInput
} from "../telegram-prompt-input";

describe("telegram-prompt-input", () => {
  it("extracts largest photo variant and caption", () => {
    /* Telegram sends several photo sizes; the biggest one should be forwarded to agent. */
    const result = extractTelegramPhotoInput({
      message_id: 10,
      caption: "Посмотри на схему",
      media_group_id: "group-1",
      photo: [
        { file_id: "small", file_size: 100 },
        { file_id: "large", file_size: 400 }
      ]
    });

    expect(result).toEqual({
      messageId: 10,
      text: "Посмотри на схему",
      attachments: [
        {
          kind: "photo",
          telegramFileId: "large",
          fileName: null,
          mimeType: "image/jpeg",
          fileSizeBytes: 400,
          mediaGroupId: "group-1"
        }
      ]
    });
  });

  it("extracts plain photo without caption as attachment-only payload", () => {
    /* Photo without text should still be forwarded so the agent can inspect the image directly. */
    const result = extractTelegramPhotoInput({
      message_id: 12,
      media_group_id: "group-2",
      photo: [{ file_id: "only-photo", file_size: 256 }]
    });

    expect(result).toEqual({
      messageId: 12,
      attachments: [
        {
          kind: "photo",
          telegramFileId: "only-photo",
          fileName: null,
          mimeType: "image/jpeg",
          fileSizeBytes: 256,
          mediaGroupId: "group-2"
        }
      ]
    });
  });

  it("extracts image document and ignores non-image documents", () => {
    /* Only image documents should be treated as visual attachments for agent prompts. */
    const image = extractTelegramImageDocumentInput({
      message_id: 11,
      caption: "Сравни этот скрин",
      document: {
        file_id: "doc-1",
        file_name: "screen.png",
        mime_type: "image/png",
        file_size: 123
      }
    });
    const nonImage = extractTelegramImageDocumentInput({
      message_id: 12,
      document: {
        file_id: "doc-2",
        file_name: "archive.zip",
        mime_type: "application/zip",
        file_size: 321
      }
    });

    expect(image).toEqual({
      messageId: 11,
      text: "Сравни этот скрин",
      attachments: [
        {
          kind: "document",
          telegramFileId: "doc-1",
          fileName: "screen.png",
          mimeType: "image/png",
          fileSizeBytes: 123,
          mediaGroupId: null
        }
      ]
    });
    expect(nonImage).toBeNull();
  });

  it("extracts PDF documents for file-aware agent prompts", () => {
    /* PDF uploads should keep filename and MIME metadata so the backend can pass them as file parts. */
    const result = extractTelegramImageDocumentInput({
      message_id: 13,
      caption: "Посмотри приказ",
      document: {
        file_id: "pdf-1",
        file_name: "prikaz.pdf",
        mime_type: "application/pdf",
        file_size: 2048
      }
    });

    expect(result).toEqual({
      messageId: 13,
      text: "Посмотри приказ",
      attachments: [
        {
          kind: "document",
          telegramFileId: "pdf-1",
          fileName: "prikaz.pdf",
          mimeType: "application/pdf",
          fileSizeBytes: 2048,
          mediaGroupId: null
        }
      ]
    });
  });

  it("builds backend payload with text, attachment and message id", () => {
    /* Bot should send one normalized payload shape for text, photo and voice flows. */
    expect(
      buildTelegramPromptEnqueueBody({
        text: "Привет",
        messageId: 15,
        attachments: [
          {
            kind: "photo",
            telegramFileId: "file-1",
            fileName: null,
            mimeType: "image/jpeg",
            fileSizeBytes: 555,
            mediaGroupId: null
          }
        ]
      })
    ).toEqual({
      text: "Привет",
      messageId: 15,
      attachments: [
        {
          kind: "photo",
          telegramFileId: "file-1",
          fileName: null,
          mimeType: "image/jpeg",
          fileSizeBytes: 555,
          mediaGroupId: null
        }
      ]
    });
  });
});
