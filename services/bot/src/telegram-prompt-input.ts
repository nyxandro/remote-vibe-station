/**
 * @fileoverview Helpers that normalize Telegram text and image updates into one backend payload shape.
 *
 * Exports:
 * - TelegramPromptAttachmentInput (L11) - Attachment metadata sent to backend enqueue endpoint.
 * - TelegramPromptEnqueueBody (L20) - Shared bot-to-backend payload for prompt chunks.
 * - extractTelegramPhotoInput (L26) - Normalizes photo messages with caption and largest image variant.
 * - extractTelegramImageDocumentInput (L57) - Normalizes image documents while rejecting non-image files.
 * - buildTelegramPromptEnqueueBody (L88) - Builds stable JSON payload for backend enqueue route.
 */

export type TelegramPromptAttachmentInput = {
  kind: "photo" | "document";
  telegramFileId: string;
  fileName: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  mediaGroupId: string | null;
};

export type TelegramPromptEnqueueBody = {
  text?: string;
  messageId?: number;
  attachments?: TelegramPromptAttachmentInput[];
};

export const extractTelegramPhotoInput = (message: unknown): TelegramPromptEnqueueBody | null => {
  /* Telegram photo updates contain multiple resolutions; choose the biggest file for vision context. */
  const candidate = message as {
    message_id?: number;
    caption?: string;
    media_group_id?: string;
    photo?: Array<{ file_id?: string; file_size?: number }>;
  };

  const sizes = Array.isArray(candidate?.photo) ? candidate.photo : [];
  const selected = sizes.reduce<{ file_id?: string; file_size?: number } | null>((largest, current) => {
    if (!current || typeof current.file_id !== "string") {
      return largest;
    }
    if (!largest) {
      return current;
    }
    return Number(current.file_size ?? 0) >= Number(largest.file_size ?? 0) ? current : largest;
  }, null);

  if (!selected?.file_id) {
    return null;
  }

  return buildTelegramPromptEnqueueBody({
    text: typeof candidate?.caption === "string" ? candidate.caption : undefined,
    messageId: typeof candidate?.message_id === "number" ? candidate.message_id : undefined,
    attachments: [
      {
        kind: "photo",
        telegramFileId: selected.file_id,
        fileName: null,
        mimeType: "image/jpeg",
        fileSizeBytes: typeof selected.file_size === "number" ? selected.file_size : null,
        mediaGroupId: typeof candidate?.media_group_id === "string" ? candidate.media_group_id : null
      }
    ]
  });
};

export const extractTelegramImageDocumentInput = (message: unknown): TelegramPromptEnqueueBody | null => {
  /* Treat only image documents as agent-visible pictures; other files stay outside this flow. */
  const candidate = message as {
    message_id?: number;
    caption?: string;
    media_group_id?: string;
    document?: { file_id?: string; file_name?: string; mime_type?: string; file_size?: number };
  };

  const document = candidate?.document;
  const fileId = typeof document?.file_id === "string" ? document.file_id.trim() : "";
  const mimeType = typeof document?.mime_type === "string" ? document.mime_type.trim() : "";
  if (!fileId || !mimeType.startsWith("image/")) {
    return null;
  }

  return buildTelegramPromptEnqueueBody({
    text: typeof candidate?.caption === "string" ? candidate.caption : undefined,
    messageId: typeof candidate?.message_id === "number" ? candidate.message_id : undefined,
    attachments: [
      {
        kind: "document",
        telegramFileId: fileId,
        fileName: typeof document?.file_name === "string" ? document.file_name : null,
        mimeType,
        fileSizeBytes: typeof document?.file_size === "number" ? document.file_size : null,
        mediaGroupId: typeof candidate?.media_group_id === "string" ? candidate.media_group_id : null
      }
    ]
  });
};

export const buildTelegramPromptEnqueueBody = (input: TelegramPromptEnqueueBody): TelegramPromptEnqueueBody => {
  /* Keep one stable payload shape so text, images and transcribed voice share the same endpoint. */
  const text = typeof input.text === "string" ? input.text.trim() : "";
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];

  return {
    ...(text.length > 0 ? { text } : {}),
    ...(typeof input.messageId === "number" ? { messageId: input.messageId } : {}),
    ...(attachments.length > 0 ? { attachments } : {})
  };
};
