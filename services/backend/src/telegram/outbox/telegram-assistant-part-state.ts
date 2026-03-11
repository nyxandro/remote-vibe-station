/**
 * @fileoverview Tracks assistant text-part lifecycle for Telegram runtime streaming.
 *
 * Exports:
 * - TelegramAssistantPartState - Remembers open/finalized text parts to ignore late SSE replays.
 */

const MAX_CLOSED_TEXT_PARTS_PER_SESSION = 4_096;
const SESSION_STATE_TTL_MS = 24 * 60 * 60_000;

export class TelegramAssistantPartState {
  private readonly openTextPartIdsBySession = new Map<string, Set<string>>();
  private readonly closedTextPartIdsBySession = new Map<string, string[]>();
  private readonly closedTextPartIdSetBySession = new Map<string, Set<string>>();
  private readonly lastAccessAtMsBySession = new Map<string, number>();

  public rememberOpenTextPart(sessionID: string, partID: string): boolean {
    const nowMs = Date.now();
    this.pruneStaleSessions(nowMs);
    this.touchSession(sessionID, nowMs);

    /* Replayed text parts from a completed turn must not become active again. */
    if (this.isClosedTextPart(sessionID, partID)) {
      return false;
    }

    /* Keep one active set per session so finalization can close the whole turn at once. */
    const openTextPartIds = this.openTextPartIdsBySession.get(sessionID) ?? new Set<string>();
    openTextPartIds.add(partID);
    this.openTextPartIdsBySession.set(sessionID, openTextPartIds);
    return true;
  }

  public isClosedTextPart(sessionID: string, partID: string): boolean {
    const nowMs = Date.now();
    this.pruneStaleSessions(nowMs);
    this.touchSession(sessionID, nowMs);

    /* Closed text parts belong to an already delivered Telegram reply/commentary block. */
    return this.closedTextPartIdSetBySession.get(sessionID)?.has(partID) ?? false;
  }

  public closeOpenTextParts(sessionID: string): void {
    const nowMs = Date.now();
    this.pruneStaleSessions(nowMs);
    this.touchSession(sessionID, nowMs);

    /* Move active text parts into a bounded closed cache so late runtime replays are ignored. */
    const openTextPartIds = this.openTextPartIdsBySession.get(sessionID);
    if (!openTextPartIds || openTextPartIds.size === 0) {
      return;
    }

    const closedQueue = this.closedTextPartIdsBySession.get(sessionID) ?? [];
    const closedSet = this.closedTextPartIdSetBySession.get(sessionID) ?? new Set<string>();

    openTextPartIds.forEach((partID) => {
      if (closedSet.has(partID)) {
        return;
      }

      closedSet.add(partID);
      closedQueue.push(partID);
    });

    /* Keep memory bounded even for very long sessions with many streamed text blocks. */
    while (closedQueue.length > MAX_CLOSED_TEXT_PARTS_PER_SESSION) {
      const droppedPartID = closedQueue.shift();
      if (!droppedPartID) {
        break;
      }

      closedSet.delete(droppedPartID);
    }

    this.closedTextPartIdsBySession.set(sessionID, closedQueue);
    this.closedTextPartIdSetBySession.set(sessionID, closedSet);
    this.openTextPartIdsBySession.delete(sessionID);
  }

  public removeSession(sessionID: string): void {
    /* Allow explicit cleanup when callers know a session can no longer emit late replay events. */
    this.openTextPartIdsBySession.delete(sessionID);
    this.closedTextPartIdsBySession.delete(sessionID);
    this.closedTextPartIdSetBySession.delete(sessionID);
    this.lastAccessAtMsBySession.delete(sessionID);
  }

  private touchSession(sessionID: string, nowMs: number): void {
    /* Track freshness so stale per-session replay guards do not grow without bounds. */
    this.lastAccessAtMsBySession.set(sessionID, nowMs);
  }

  private pruneStaleSessions(nowMs: number): void {
    /* Keep one-day replay history because production sessions can stay active for many hours. */
    this.lastAccessAtMsBySession.forEach((lastAccessAtMs, sessionID) => {
      if (nowMs - lastAccessAtMs <= SESSION_STATE_TTL_MS) {
        return;
      }

      this.removeSession(sessionID);
    });
  }
}
