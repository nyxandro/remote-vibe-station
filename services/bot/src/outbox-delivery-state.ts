/**
 * @fileoverview In-memory delivery state for Telegram outbox acknowledgements.
 *
 * Exports:
 * - OutboxDeliveryResult - normalized delivery report shape reused by worker caches.
 * - OutboxDeliveryState - keeps successful send receipts and pending backend reports.
 */

const DELIVERY_RECEIPT_TTL_MS = 6 * 60 * 60_000;

export type OutboxDeliveryResult = {
  id: string;
  ok: boolean;
  telegramMessageId?: number;
  error?: string;
  retryAfterSec?: number;
};

export class OutboxDeliveryState {
  private readonly pendingReportResultsByAdmin = new Map<number, OutboxDeliveryResult[]>();
  private readonly successfulDeliveryByItemId = new Map<string, { result: OutboxDeliveryResult; updatedAtMs: number }>();

  public rememberSuccessful(result: OutboxDeliveryResult): void {
    /* Only successful Telegram sends should be reused after a flaky backend report acknowledgement. */
    if (!result.ok) {
      return;
    }

    this.successfulDeliveryByItemId.set(result.id, {
      result,
      updatedAtMs: Date.now()
    });
  }

  public getSuccessful(itemId: string): OutboxDeliveryResult | null {
    /* Reusing the same result prevents duplicate Telegram messages for the same outbox item id. */
    const cached = this.successfulDeliveryByItemId.get(itemId);
    if (!cached) {
      return null;
    }

    cached.updatedAtMs = Date.now();
    return cached.result;
  }

  public rememberPendingReports(adminId: number, results: OutboxDeliveryResult[]): void {
    /* Keep one latest result per item so retries can replay acknowledgements without re-sending. */
    const merged = new Map<string, OutboxDeliveryResult>();
    (this.pendingReportResultsByAdmin.get(adminId) ?? []).forEach((result) => merged.set(result.id, result));
    results.forEach((result) => merged.set(result.id, result));
    this.pendingReportResultsByAdmin.set(adminId, Array.from(merged.values()));
  }

  public getPendingReports(adminId: number): OutboxDeliveryResult[] {
    /* Worker flushes these before pulling new items for the same admin. */
    return this.pendingReportResultsByAdmin.get(adminId) ?? [];
  }

  public clearReported(adminId: number, results: OutboxDeliveryResult[]): void {
    /* Once backend acks the batch, we can safely drop both pending report queue and send receipts. */
    this.pendingReportResultsByAdmin.delete(adminId);
    results.forEach((result) => this.successfulDeliveryByItemId.delete(result.id));
  }

  public prune(nowMs: number): void {
    /* Delivery receipts only need bounded retention for transient backend/report failures. */
    for (const [itemId, value] of this.successfulDeliveryByItemId.entries()) {
      if (nowMs - value.updatedAtMs > DELIVERY_RECEIPT_TTL_MS) {
        this.successfulDeliveryByItemId.delete(itemId);
      }
    }
  }
}
