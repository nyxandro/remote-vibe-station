/**
 * @fileoverview Parser/formatter for OpenCode SSE event payloads.
 *
 * Goal:
 * - Reduce noisy internal events into a readable Telegram stream.
 * - Prefer forwarding only assistant/user-visible text.
 *
 * Exports:
 * - formatOpenCodeSsePayload (L26) - Parses JSON payload and returns readable text.
 */

type AnyRecord = Record<string, unknown>;

const tryParseJson = (raw: string): unknown => {
  /* Best-effort JSON parsing for SSE payloads. */
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const getNested = (obj: unknown, path: string[]): unknown => {
  /* Safely read deep properties without throwing. */
  let current: unknown = obj;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as AnyRecord)[key];
  }
  return current;
};

const extractTextFromUnknown = (value: unknown): string | null => {
  /*
   * OpenCode message text is often emitted as separate TextPart events.
   * We scan common shapes:
   * - properties.part.text
   * - properties.info.text
   * - properties.parts[].text
   */
  const partText = getNested(value, ["properties", "part", "text"]);
  if (typeof partText === "string" && partText.trim()) {
    return partText;
  }

  const infoText = getNested(value, ["properties", "info", "text"]);
  if (typeof infoText === "string" && infoText.trim()) {
    return infoText;
  }

  const parts = getNested(value, ["properties", "parts"]);
  if (Array.isArray(parts)) {
    const texts = parts
      .map((p) => (p && typeof p === "object" ? (p as any).text : null))
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
    if (texts.length > 0) {
      return texts.join("");
    }
  }

  return null;
};

export const formatOpenCodeSsePayload = (payload: string): string | null => {
  /*
   * OpenCode emits JSON objects like:
   * { type: "message.updated", properties: { ... } }
   */
  const parsed = tryParseJson(payload);

  /*
   * Some OpenCode SSE frames contain plain human-readable text
   * (not JSON). Forward it as-is.
   */
  if (!parsed) {
    const text = payload.trim();
    if (!text) {
      return null;
    }
    /* Ignore obvious protocol lines. */
    if (text.startsWith("{") || text.startsWith("event:") || text.startsWith("data:")) {
      return null;
    }
    return text;
  }

  if (typeof parsed !== "object") {
    return null;
  }

  const type = getNested(parsed, ["type"]);
  if (typeof type !== "string") {
    return null;
  }

  /*
   * Prefer extracting text parts from any event type.
   * This covers the common case where assistant output is emitted as TextPart.
   */
  const anyText = extractTextFromUnknown(parsed);
  if (anyText) {
    return anyText;
  }

  /*
   * Ignore status/diff noise by default.
   * We only forward human-readable assistant output.
   */
  if (type === "session.status" || type === "session.idle" || type === "session.updated" || type === "session.diff") {
    return null;
  }

  /*
   * Some OpenCode builds may emit streaming deltas.
   * If a delta-like event has text, forward it.
   */
  if (type.includes("delta") || type.includes("chunk") || type.includes("output")) {
    const text = getNested(parsed, ["properties", "text"]);
    if (typeof text === "string" && text.trim().length > 0) {
      return text;
    }
  }

  /*
   * Surface structured errors when present.
   * This keeps Telegram useful when OpenCode fails.
   */
  const error = getNested(parsed, ["properties", "error"]);
  if (typeof error === "string" && error.trim().length > 0) {
    return `OpenCode error: ${error}`;
  }

  return null;
};
