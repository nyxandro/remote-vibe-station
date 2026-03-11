/**
 * @fileoverview Guards Telegram runtime delivery from replayed finalized OpenCode parts.
 *
 * Exports:
 * - TelegramRuntimePartReplayGuard - Remembers finalized non-text part ids per session to ignore stale replays.
 */

const MAX_FINALIZED_PARTS_PER_SESSION = 8_192;
const SESSION_STATE_TTL_MS = 24 * 60 * 60_000;

export class TelegramRuntimePartReplayGuard {
  private readonly finalizedPartIdsBySession = new Map<string, string[]>();
  private readonly finalizedPartIdSetBySession = new Map<string, Set<string>>();
  private readonly lastAccessAtMsBySession = new Map<string, number>();

  public rememberFinalizedPart(sessionID: string, partID: string): boolean {
    const nowMs = Date.now();
    this.pruneStaleSessions(nowMs);
    this.touchSession(sessionID, nowMs);

    /* Replayed finalized tool parts must not emit another Telegram message burst. */
    const finalizedSet = this.finalizedPartIdSetBySession.get(sessionID) ?? new Set<string>();
    if (finalizedSet.has(partID)) {
      return false;
    }

    /* Keep a bounded insertion-order queue so long sessions do not grow memory without limit. */
    const finalizedQueue = this.finalizedPartIdsBySession.get(sessionID) ?? [];
    finalizedSet.add(partID);
    finalizedQueue.push(partID);

    while (finalizedQueue.length > MAX_FINALIZED_PARTS_PER_SESSION) {
      const droppedPartID = finalizedQueue.shift();
      if (!droppedPartID) {
        break;
      }

      finalizedSet.delete(droppedPartID);
    }

    this.finalizedPartIdsBySession.set(sessionID, finalizedQueue);
    this.finalizedPartIdSetBySession.set(sessionID, finalizedSet);
    return true;
  }

  public removeSession(sessionID: string): void {
    /* Allow explicit cleanup when callers know replay protection is no longer needed. */
    this.finalizedPartIdsBySession.delete(sessionID);
    this.finalizedPartIdSetBySession.delete(sessionID);
    this.lastAccessAtMsBySession.delete(sessionID);
  }

  private touchSession(sessionID: string, nowMs: number): void {
    /* Track freshness so replay guards expire naturally after the risky reconnect window. */
    this.lastAccessAtMsBySession.set(sessionID, nowMs);
  }

  private pruneStaleSessions(nowMs: number): void {
    /* Keep one-day replay history because the same Telegram/OpenCode session can run for many hours. */
    this.lastAccessAtMsBySession.forEach((lastAccessAtMs, sessionID) => {
      if (nowMs - lastAccessAtMs <= SESSION_STATE_TTL_MS) {
        return;
      }

      this.removeSession(sessionID);
    });
  }
}
