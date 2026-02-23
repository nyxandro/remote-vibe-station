/**
 * @fileoverview Tests for Telegram voice-control helpers.
 *
 * Exports:
 * - (none)
 */

import {
  buildTranscriptionSuccessHtml,
  extractTelegramVoiceInput,
  validateVoiceInput
} from "../voice-control";

describe("extractTelegramVoiceInput", () => {
  it("extracts payload from voice messages", () => {
    /* Telegram voice notes provide file id, duration and file size metadata. */
    const payload = extractTelegramVoiceInput({
      voice: {
        file_id: "abc123",
        duration: 5,
        file_size: 1024,
        mime_type: "audio/ogg"
      }
    });

    expect(payload).toEqual({
      fileId: "abc123",
      durationSeconds: 5,
      fileSizeBytes: 1024,
      mimeType: "audio/ogg"
    });
  });

  it("returns null when message does not contain voice/audio", () => {
    /* Text-only updates must be ignored by voice transcription path. */
    expect(extractTelegramVoiceInput({ text: "hello" })).toBeNull();
  });
});

describe("validateVoiceInput", () => {
  it("rejects files larger than 25 MB", () => {
    /* Groq free-tier file size cap must be checked before API upload. */
    const error = validateVoiceInput({
      fileId: "x",
      fileSizeBytes: 25 * 1024 * 1024 + 1,
      durationSeconds: 12,
      mimeType: "audio/ogg"
    });

    expect(error).toContain("25 MB");
  });

  it("accepts valid audio metadata", () => {
    const error = validateVoiceInput({
      fileId: "x",
      fileSizeBytes: 1000,
      durationSeconds: 1,
      mimeType: "audio/ogg"
    });

    expect(error).toBeNull();
  });
});

describe("buildTranscriptionSuccessHtml", () => {
  it("wraps recognized text in Telegram blockquote", () => {
    /* HTML is escaped and quoted so Telegram renders safe citation markup. */
    const html = buildTranscriptionSuccessHtml("<done> & ok");

    expect(html).toContain("<blockquote>");
    expect(html).toContain("&lt;done&gt; &amp; ok");
  });
});
