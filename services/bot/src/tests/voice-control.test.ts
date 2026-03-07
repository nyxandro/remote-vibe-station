/**
 * @fileoverview Tests for Telegram voice-control helpers.
 *
 * Exports:
 * - (none)
 */

import {
  VOICE_TRANSCRIPTION_NOT_CONFIGURED_MESSAGE,
  buildTranscriptionFailureMessage,
  buildTranscriptionSuccessHtml,
  extractTelegramVoiceInput,
  transcribeTelegramAudioWithGroq,
  validateVoiceInput
} from "../voice-control";

jest.mock("undici", () => ({
  ProxyAgent: jest.fn().mockImplementation((input: { uri: string }) => ({
    kind: "proxy-agent",
    uri: input.uri
  }))
}));

const originalFetch = global.fetch;
const originalHttpProxy = process.env.HTTP_PROXY;
const originalHttpsProxy = process.env.HTTPS_PROXY;
const originalAllProxy = process.env.ALL_PROXY;
const originalNoProxy = process.env.NO_PROXY;

describe("transcribeTelegramAudioWithGroq", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    process.env.HTTP_PROXY = originalHttpProxy;
    process.env.HTTPS_PROXY = originalHttpsProxy;
    process.env.ALL_PROXY = originalAllProxy;
    process.env.NO_PROXY = originalNoProxy;
    jest.clearAllMocks();
  });

  it("routes Groq transcription through configured HTTPS proxy", async () => {
    /* External AI requests must use the VLESS proxy when HTTPS_PROXY is configured. */
    process.env.HTTPS_PROXY = "http://vless-proxy:8080";
    delete process.env.HTTP_PROXY;
    delete process.env.ALL_PROXY;
    delete process.env.NO_PROXY;

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("voice").buffer
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: "ready" })
      });

    global.fetch = fetchMock as unknown as typeof fetch;

    const text = await transcribeTelegramAudioWithGroq({
      telegramFileUrl: "https://api.telegram.org/file/bot/voice.ogg",
      apiKey: "gsk_test",
      model: "whisper-large-v3-turbo",
      mimeType: "audio/ogg"
    });

    expect(text).toBe("ready");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.telegram.org/file/bot/voice.ogg"
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.groq.com/openai/v1/audio/transcriptions",
      expect.objectContaining({
        dispatcher: expect.objectContaining({
          kind: "proxy-agent",
          uri: "http://vless-proxy:8080"
        })
      })
    );
  });

  it("bypasses proxy for hosts covered by NO_PROXY", async () => {
    /* Internal or explicitly excluded hosts must not be forced through the external proxy. */
    process.env.HTTPS_PROXY = "http://vless-proxy:8080";
    process.env.NO_PROXY = "api.groq.com";

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("voice").buffer
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: "ready" })
      });

    global.fetch = fetchMock as unknown as typeof fetch;

    await transcribeTelegramAudioWithGroq({
      telegramFileUrl: "https://api.telegram.org/file/bot/voice.ogg",
      apiKey: "gsk_test",
      model: "whisper-large-v3-turbo",
      mimeType: "audio/ogg"
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.groq.com/openai/v1/audio/transcriptions",
      expect.not.objectContaining({ dispatcher: expect.anything() })
    );
  });
});

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

    expect(html).toContain("🎤 Голосовое сообщение распознано как:");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("&lt;done&gt; &amp; ok");
  });
});

describe("buildTranscriptionFailureMessage", () => {
  it("returns setup hint for settings endpoint failures", () => {
    /* Missing/invalid saved settings must still show concise setup instruction. */
    const message = buildTranscriptionFailureMessage(
      new Error("Failed to fetch voice-control settings: 401")
    );

    expect(message).toBe(VOICE_TRANSCRIPTION_NOT_CONFIGURED_MESSAGE);
  });

  it("returns detailed runtime message for other failures", () => {
    /* Runtime errors should be visible to help distinguish API/network issues. */
    const message = buildTranscriptionFailureMessage(new Error("Groq transcription failed: 429"));

    expect(message).toContain("Не удалось распознать голосовое сообщение");
    expect(message).toContain("Groq transcription failed: 429");
  });
});
