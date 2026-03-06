/**
 * @fileoverview Tests for Mini App system-metrics endpoint controller.
 */

import { Request } from "express";

import { SystemMetricsController } from "../system-metrics.controller";

describe("SystemMetricsController", () => {
  test("returns current metrics snapshot for authenticated admin", async () => {
    /* Endpoint contract should pass through metrics payload unchanged. */
    const metrics = {
      getSnapshot: jest.fn().mockResolvedValue({
        capturedAt: "2026-03-06T10:00:00.000Z",
        cpu: { cores: 8, load1: 0.5, load5: 0.4, load15: 0.35 },
        memory: {
          totalBytes: 16000000000,
          freeBytes: 4000000000,
          usedBytes: 12000000000,
          freePercent: 25,
          usedPercent: 75
        },
        disk: {
          rootPath: "/srv/projects",
          totalBytes: 500000000000,
          freeBytes: 100000000000,
          usedBytes: 400000000000,
          freePercent: 20,
          usedPercent: 80
        },
        network: { interfaces: 2, rxBytes: 1000, txBytes: 2000 }
      })
    };

    const controller = new SystemMetricsController(metrics as never);
    const result = await controller.getMetrics({ authAdminId: 649624756 } as unknown as Request);

    expect(metrics.getSnapshot).toHaveBeenCalledTimes(1);
    expect(result.cpu.cores).toBe(8);
    expect(result.network.txBytes).toBe(2000);
  });
});
