/**
 * @fileoverview Authenticated Mini App endpoint for server diagnostics metrics.
 *
 * Exports:
 * - SystemMetricsController - Returns CPU/RAM/disk/network snapshot for Settings tab.
 */

import { Controller, Get, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { AppAuthGuard } from "../security/app-auth.guard";
import { SystemMetricsService } from "./system-metrics.service";

@Controller("api/telegram/system")
export class SystemMetricsController {
  public constructor(private readonly systemMetrics: SystemMetricsService) {}

  @UseGuards(AppAuthGuard)
  @Get("metrics")
  public async getMetrics(@Req() req: Request) {
    /* Keep admin identity check explicit for parity with other Mini App controllers. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (adminId == null) {
      throw new UnauthorizedException("Admin identity missing");
    }

    return this.systemMetrics.getSnapshot();
  }
}
