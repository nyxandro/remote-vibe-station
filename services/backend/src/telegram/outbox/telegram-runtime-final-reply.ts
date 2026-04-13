/**
 * @fileoverview Fallback final-reply delivery for runtime-only OpenCode completions.
 *
 * Exports:
 * - TelegramRuntimeFinalReplyMeta - Footer metadata remembered at turn start.
 * - TelegramRuntimeFinalReply - Converts buffered runtime text into one final Telegram assistant reply.
 */

import { TelegramOutboxService } from "./telegram-outbox.service";

export type TelegramRuntimeFinalReplyMeta = {
  providerID: string;
  modelID: string;
  thinking: string | null;
  agent: string;
};

type StoredRuntimeFinalReplyMeta = {
  meta: TelegramRuntimeFinalReplyMeta;
  updatedAtMs: number;
};

const ZERO_TOKENS = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 }
};
const META_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_META_SESSIONS = 1024;

export class TelegramRuntimeFinalReply {
  private readonly metaBySession = new Map<string, StoredRuntimeFinalReplyMeta>();
  private readonly publishedSessions = new Set<string>();

  public constructor(private readonly outbox: TelegramOutboxService) {}

  public rememberTurnStart(input: { sessionID: string; meta?: Partial<TelegramRuntimeFinalReplyMeta> | null }): void {
    /* Runtime-only fallback needs footer metadata before the synchronous HTTP result may disappear. */
    this.prune(Date.now());
    this.publishedSessions.delete(input.sessionID);
    const providerID = String(input.meta?.providerID ?? "").trim();
    const modelID = String(input.meta?.modelID ?? "").trim();
    const agent = String(input.meta?.agent ?? "").trim();
    if (!providerID || !modelID || !agent) {
      return;
    }

    this.metaBySession.set(input.sessionID, {
      meta: {
        providerID,
        modelID,
        thinking: typeof input.meta?.thinking === "string" ? input.meta.thinking : null,
        agent
      },
      updatedAtMs: Date.now()
    });

    while (this.metaBySession.size > MAX_META_SESSIONS) {
      const oldestSessionID = this.metaBySession.keys().next().value;
      if (!oldestSessionID) {
        break;
      }
      this.metaBySession.delete(oldestSessionID);
    }
  }

  public enqueueBufferedFinalReply(input: { sessionID: string; adminId: number; text: string }): boolean {
    /* When HTTP finalization is absent, buffered runtime text becomes the authoritative final Telegram reply. */
    this.prune(Date.now());
    if (this.publishedSessions.has(input.sessionID)) {
      return false;
    }
    const text = input.text.trim();
    const stored = this.metaBySession.get(input.sessionID);
    if (!text || !stored) {
      return false;
    }
    stored.updatedAtMs = Date.now();
    const meta = stored.meta;

    this.outbox.enqueueAssistantReply({
      adminId: input.adminId,
      delivery: {
        sessionId: input.sessionID,
        text,
        providerID: meta.providerID,
        modelID: meta.modelID,
        thinking: meta.thinking,
        agent: meta.agent,
        tokens: ZERO_TOKENS
      }
    });
    this.publishedSessions.add(input.sessionID);
    return true;
  }

  public markPublished(sessionID: string): void {
    /* Authoritative HTTP final reply wins over any later idle-based fallback for the same turn. */
    this.publishedSessions.add(sessionID);
  }

  public touchSession(sessionID: string): void {
    /* Active runtime deltas should keep fallback footer metadata alive for genuinely long-running turns. */
    this.prune(Date.now());
    const stored = this.metaBySession.get(sessionID);
    if (!stored) {
      return;
    }

    stored.updatedAtMs = Date.now();
  }

  public clearSession(sessionID: string): void {
    /* Turn-scoped footer metadata should not leak into future unrelated sessions. */
    this.metaBySession.delete(sessionID);
    this.publishedSessions.delete(sessionID);
  }

  private prune(nowMs: number): void {
    /* Runtime-only metadata must not accumulate forever if a session never reaches the normal clear path. */
    for (const [sessionID, value] of this.metaBySession.entries()) {
      if (nowMs - value.updatedAtMs <= META_TTL_MS) {
        continue;
      }
      this.metaBySession.delete(sessionID);
      this.publishedSessions.delete(sessionID);
    }

    /* Published-only sessions can outlive metadata after FIFO eviction, so prune orphan ids here as well. */
    for (const sessionID of this.publishedSessions) {
      if (this.metaBySession.has(sessionID)) {
        continue;
      }
      this.publishedSessions.delete(sessionID);
    }
  }
}
