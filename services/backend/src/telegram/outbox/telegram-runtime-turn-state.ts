/**
 * @fileoverview Tracks whether Telegram should currently accept runtime events for each OpenCode session.
 *
 * Exports:
 * - TelegramRuntimeTurnState - Opens on prompt dispatch and fences late replay for a bounded retention window.
 */

const CLOSED_TURN_TTL_MS = 24 * 60 * 60_000;
const MAX_CLOSED_TURNS = 4_096;

export class TelegramRuntimeTurnState {
  private readonly closedSessionIds = new Map<string, number>();

  public openTurn(sessionID: string): void {
    /* Explicit prompt start reopens a session that was previously fenced by a final reply or idle event. */
    this.closedSessionIds.delete(sessionID);
  }

  public closeTurn(sessionID: string): void {
    /* Final replies and idle transitions close the gate until the next explicit prompt starts. */
    const nowMs = Date.now();
    this.prune(nowMs);
    this.closedSessionIds.set(sessionID, nowMs);

    while (this.closedSessionIds.size > MAX_CLOSED_TURNS) {
      const oldestSessionID = this.closedSessionIds.keys().next().value;
      if (!oldestSessionID) {
        break;
      }
      this.closedSessionIds.delete(oldestSessionID);
    }
  }

  public isTurnOpen(sessionID: string): boolean {
    /* Unknown sessions stay open for backward compatibility; only recently closed turns are blocked. */
    const nowMs = Date.now();
    this.prune(nowMs);
    return !this.closedSessionIds.has(sessionID);
  }

  private prune(nowMs: number): void {
    /* Closed-turn fences only need to live long enough to outlast delayed SSE replay after a finished turn. */
    for (const [sessionID, closedAtMs] of this.closedSessionIds.entries()) {
      if (nowMs - closedAtMs <= CLOSED_TURN_TTL_MS) {
        continue;
      }
      this.closedSessionIds.delete(sessionID);
    }
  }
}
