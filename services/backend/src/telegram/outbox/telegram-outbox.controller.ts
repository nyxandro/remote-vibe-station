/**
 * @fileoverview Bot-facing endpoints for pulling and reporting Telegram outbox.
 *
 * Exports:
 * - TelegramOutboxController (L22) - GET pull and POST report endpoints.
 */

import { BadRequestException, Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { AdminHeaderGuard } from "../../security/admin-header.guard";
import { TelegramOutboxStore } from "./telegram-outbox.store";
import { OutboxReportResult } from "./telegram-outbox.types";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const WORKER_HEADER = "x-bot-worker-id";

@Controller("api/telegram/outbox")
export class TelegramOutboxController {
  public constructor(private readonly store: TelegramOutboxStore) {}

  @UseGuards(AdminHeaderGuard)
  @Get("pull")
  public pull(@Req() req: Request, @Query("limit") limitRaw?: string) {
    /* Bot polls for due messages; response is leased to the worker. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    const workerId = (req.headers?.[WORKER_HEADER] as string | undefined) ?? "";
    if (!workerId || workerId.trim().length === 0) {
      throw new BadRequestException(`${WORKER_HEADER} header is required`);
    }

    const parsed = limitRaw ? Number(limitRaw) : DEFAULT_LIMIT;
    const limit = Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_LIMIT, parsed)) : DEFAULT_LIMIT;

    return {
      items: this.store.pull({ adminId, limit, workerId })
    };
  }

  @UseGuards(AdminHeaderGuard)
  @Post("report")
  public report(@Req() req: Request, @Body() body: { results?: OutboxReportResult[] }) {
    /* Bot reports delivery result for leased messages. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    const workerId = (req.headers?.[WORKER_HEADER] as string | undefined) ?? "";
    if (!workerId || workerId.trim().length === 0) {
      throw new BadRequestException(`${WORKER_HEADER} header is required`);
    }

    const results = body?.results;
    if (!Array.isArray(results) || results.length === 0) {
      throw new BadRequestException("results are required");
    }

    this.store.report({ adminId, workerId, results });
    this.store.pruneDelivered();
    return { ok: true };
  }
}
