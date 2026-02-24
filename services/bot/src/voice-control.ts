/**
 * @fileoverview Telegram voice-to-text helpers backed by Groq Whisper API.
 *
 * Exports:
 * - GROQ_TRANSCRIPTION_MODELS (L15) - Supported Groq Whisper model ids.
 * - VOICE_TRANSCRIPTION_NOT_CONFIGURED_MESSAGE (L18) - User-facing setup hint.
 * - VOICE_TRANSCRIPTION_PROGRESS_MESSAGE (L19) - Progress text while speech is processed.
 * - VoiceControlSettingsSnapshot (L21) - Backend payload shape for voice settings.
 * - TelegramVoiceInput (L28) - Normalized Telegram voice/audio payload.
 * - fetchVoiceControlSettings (L38) - Loads admin voice settings from backend.
 * - extractTelegramVoiceInput (L62) - Reads voice/audio metadata from Telegram message.
 * - validateVoiceInput (L96) - Enforces Groq file-size and duration limits.
 * - transcribeTelegramAudioWithGroq (L124) - Downloads Telegram file and calls Groq API.
 * - buildTranscriptionSuccessHtml (L187) - Formats recognized text as Telegram quote.
 */

export const GROQ_TRANSCRIPTION_MODELS = ["whisper-large-v3-turbo", "whisper-large-v3"] as const;
export const VOICE_TRANSCRIPTION_NOT_CONFIGURED_MESSAGE = "Для перевода речи в текст настройте Groq API.";
export const VOICE_TRANSCRIPTION_PROGRESS_MESSAGE = "Распознаю голосовое сообщение...";

export type VoiceControlSettingsSnapshot = {
  enabled: boolean;
  apiKey: string | null;
  model: (typeof GROQ_TRANSCRIPTION_MODELS)[number] | null;
  supportedModels?: string[];
};

export type TelegramVoiceInput = {
  fileId: string;
  fileSizeBytes: number | null;
  durationSeconds: number | null;
  mimeType: string | null;
};

const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MAX_AUDIO_FILE_BYTES = 25 * 1024 * 1024;
const GROQ_MIN_AUDIO_SECONDS = 0.01;

export const fetchVoiceControlSettings = async (
  backendUrl: string,
  adminId: number
): Promise<VoiceControlSettingsSnapshot> => {
  /* Keep bot-side voice processing aligned with settings from Mini App. */
  const response = await fetch(`${backendUrl}/api/telegram/voice-control/admin`, {
    headers: {
      "x-admin-id": String(adminId)
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch voice-control settings: ${response.status}`);
  }

  return (await response.json()) as VoiceControlSettingsSnapshot;
};

export const extractTelegramVoiceInput = (message: unknown): TelegramVoiceInput | null => {
  /* Normalize both Telegram voice and generic audio attachments to one payload. */
  if (!message || typeof message !== "object") {
    return null;
  }

  const withVoice = message as {
    voice?: { file_id?: string; file_size?: number; duration?: number; mime_type?: string };
    audio?: { file_id?: string; file_size?: number; duration?: number; mime_type?: string };
  };

  const candidate = withVoice.voice ?? withVoice.audio;
  const fileId = typeof candidate?.file_id === "string" ? candidate.file_id.trim() : "";
  if (!fileId) {
    return null;
  }

  return {
    fileId,
    fileSizeBytes: typeof candidate?.file_size === "number" ? candidate.file_size : null,
    durationSeconds: typeof candidate?.duration === "number" ? candidate.duration : null,
    mimeType: typeof candidate?.mime_type === "string" ? candidate.mime_type : null
  };
};

export const validateVoiceInput = (input: TelegramVoiceInput): string | null => {
  /* Reject files that exceed Groq free-tier size cap before upload attempt. */
  if (typeof input.fileSizeBytes === "number" && input.fileSizeBytes > GROQ_MAX_AUDIO_FILE_BYTES) {
    return "Голосовое сообщение слишком большое: лимит 25 MB.";
  }

  /* Groq requires positive duration, even when Telegram provides rounded seconds. */
  if (typeof input.durationSeconds === "number" && input.durationSeconds < GROQ_MIN_AUDIO_SECONDS) {
    return "Голосовое сообщение слишком короткое для распознавания.";
  }

  return null;
};

export const transcribeTelegramAudioWithGroq = async (input: {
  telegramFileUrl: string;
  apiKey: string;
  model: (typeof GROQ_TRANSCRIPTION_MODELS)[number];
  mimeType: string | null;
}): Promise<string> => {
  /* Download audio from Telegram first because Groq requires file/url payload. */
  const audioResponse = await fetch(input.telegramFileUrl);
  if (!audioResponse.ok) {
    throw new Error(`Failed to download Telegram file: ${audioResponse.status}`);
  }

  const audioBuffer = await audioResponse.arrayBuffer();
  if (audioBuffer.byteLength > GROQ_MAX_AUDIO_FILE_BYTES) {
    throw new Error("Telegram file exceeds Groq limit");
  }

  /* Send multipart request to Groq OpenAI-compatible transcription endpoint. */
  const form = new FormData();
  form.append(
    "file",
    new Blob([audioBuffer], {
      type: input.mimeType ?? "audio/ogg"
    }),
    fileNameForMimeType(input.mimeType)
  );
  form.append("model", input.model);
  form.append("response_format", "json");

  const response = await fetch(GROQ_TRANSCRIPTION_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`
    },
    body: form
  });

  if (!response.ok) {
    throw new Error(`Groq transcription failed: ${response.status}`);
  }

  const payload = (await response.json()) as { text?: string };
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  if (!text) {
    throw new Error("Groq transcription returned empty text");
  }

  return text;
};

const fileNameForMimeType = (mimeType: string | null): string => {
  /* Preserve extension hint so backend side can infer decoder without guessing. */
  if (!mimeType) {
    return "voice.ogg";
  }

  if (mimeType.includes("webm")) {
    return "voice.webm";
  }
  if (mimeType.includes("wav")) {
    return "voice.wav";
  }
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) {
    return "voice.mp3";
  }
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) {
    return "voice.m4a";
  }

  return "voice.ogg";
};

export const buildTranscriptionSuccessHtml = (transcribedText: string): string => {
  /* Telegram quote rendering is done with HTML blockquote for reliable formatting. */
  const escapedText = escapeHtml(transcribedText);
  return [
    "🎤 Голосовое сообщение распознано как:",
    `<blockquote>${escapedText}</blockquote>`,
    "и отправлено в чат агента"
  ].join("\n");
};

const escapeHtml = (value: string): string => {
  /* Escape only required HTML entities to keep Telegram parse_mode=HTML safe. */
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
};
