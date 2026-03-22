/**
 * @fileoverview Signed event-stream token helpers for WebSocket subscriptions.
 *
 * Exports:
 * - EventStreamTopic - Supported subscription topic ids.
 * - EventStreamTokenPayload - Signed token payload stored in HMAC token.
 * - createEventStreamToken - Creates short-lived signed WS token.
 * - verifyEventStreamToken - Verifies signed WS token and returns scoped claims.
 * - getEventStreamTokenTtlMs - Exposes token TTL for HTTP issuers.
 */

import * as crypto from "node:crypto";

const DOT = ".";
const EVENT_STREAM_TOKEN_TTL_MS = 60 * 1000;
const EVENT_STREAM_TOPICS = ["kanban", "terminal"] as const;

export type EventStreamTopic = (typeof EVENT_STREAM_TOPICS)[number];

export type EventStreamTokenPayload = {
  adminId: number;
  topics: EventStreamTopic[];
  projectSlug: string | null;
  exp: number;
  nonce: string;
};

export const createEventStreamToken = (input: {
  adminId: number;
  botToken: string;
  topics: readonly EventStreamTopic[];
  projectSlug?: string | null;
  nowMs?: number;
}): string => {
  /* Normalize and validate requested subscription scope before signing it into the token. */
  const nowMs = input.nowMs ?? Date.now();
  const topics = normalizeTopics(input.topics);
  const projectSlug = normalizeProjectSlug(input.projectSlug);
  assertScope({ topics, projectSlug });

  const payload: EventStreamTokenPayload = {
    adminId: input.adminId,
    topics,
    projectSlug,
    exp: nowMs + EVENT_STREAM_TOKEN_TTL_MS,
    nonce: crypto.randomBytes(8).toString("hex")
  };

  const payloadJson = JSON.stringify(payload);
  const payloadB64 = base64UrlEncode(Buffer.from(payloadJson, "utf-8"));
  const signatureB64 = base64UrlEncode(sign(payloadJson, input.botToken));
  return `${payloadB64}${DOT}${signatureB64}`;
};

export const verifyEventStreamToken = (input: {
  token: string;
  botToken: string;
  nowMs?: number;
}): Pick<EventStreamTokenPayload, "adminId" | "topics" | "projectSlug"> | null => {
  /* Fail closed on malformed, expired, or tampered subscription tokens. */
  const nowMs = input.nowMs ?? Date.now();
  const parts = input.token.split(DOT);
  if (parts.length !== 2) {
    return null;
  }
  const [payloadB64, signatureB64] = parts;

  const payloadJson = base64UrlDecodeToString(payloadB64);
  if (!payloadJson) {
    return null;
  }

  const expected = sign(payloadJson, input.botToken);
  const actual = base64UrlDecode(signatureB64);
  if (!actual || actual.length !== expected.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(expected, actual)) {
    return null;
  }

  const parsedPayload = safeJsonParse(payloadJson);
  if (!parsedPayload || typeof parsedPayload !== "object" || Array.isArray(parsedPayload)) {
    return null;
  }

  const payload = parsedPayload as Partial<EventStreamTokenPayload>;
  if (typeof payload.adminId !== "number" || typeof payload.exp !== "number") {
    return null;
  }

  const topics = normalizeTopics(Array.isArray(payload.topics) ? payload.topics : []);
  const projectSlug = normalizeProjectSlug(payload.projectSlug);
  try {
    assertScope({ topics, projectSlug });
  } catch {
    return null;
  }

  if (nowMs >= payload.exp) {
    return null;
  }

  return {
    adminId: payload.adminId,
    topics,
    projectSlug
  };
};

export const getEventStreamTokenTtlMs = (): number => EVENT_STREAM_TOKEN_TTL_MS;

const normalizeTopics = (topics: readonly unknown[]): EventStreamTopic[] => {
  /* Keep topic normalization deterministic so signed payloads stay stable and duplicate-free. */
  const unique = new Set<EventStreamTopic>();
  topics.forEach((topic) => {
    const normalized = typeof topic === "string" ? topic.trim() : "";
    if ((EVENT_STREAM_TOPICS as readonly string[]).includes(normalized)) {
      unique.add(normalized as EventStreamTopic);
    }
  });
  return Array.from(unique.values()).sort();
};

const normalizeProjectSlug = (value: unknown): string | null => {
  /* Keep optional project scope explicit so terminal tokens cannot drift into global subscriptions. */
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const assertScope = (input: { topics: EventStreamTopic[]; projectSlug: string | null }): void => {
  /* Terminal output is always project-bound, while kanban may stay global or project-filtered. */
  if (input.topics.length === 0) {
    throw new Error("At least one event-stream topic is required");
  }

  if (input.topics.includes("terminal") && !input.projectSlug) {
    throw new Error("projectSlug is required for terminal topic");
  }
};

const sign = (payloadJson: string, botToken: string): Buffer => {
  /* Reuse HMAC-SHA256(sha256(botToken), payload) so token verification stays symmetric with web auth. */
  const key = crypto.createHash("sha256").update(botToken).digest();
  return crypto.createHmac("sha256", key).update(payloadJson).digest();
};

const safeJsonParse = (raw: string): unknown | null => {
  /* Malformed JSON should fail as a normal auth rejection instead of crashing the gateway. */
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

const base64UrlEncode = (buf: Buffer): string => {
  /* Encode binary signature/payload into URL-safe token form without padding. */
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
};

const base64UrlDecode = (b64url: string): Buffer | null => {
  /* Reject malformed base64url fragments without surfacing low-level decoder noise. */
  try {
    const padded = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
    return Buffer.from(padded, "base64");
  } catch {
    return null;
  }
};

const base64UrlDecodeToString = (b64url: string): string | null => {
  /* Decode JSON payload helper used by token verification path. */
  const buf = base64UrlDecode(b64url);
  return buf ? buf.toString("utf-8") : null;
};
