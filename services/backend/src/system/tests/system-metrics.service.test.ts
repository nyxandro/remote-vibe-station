/**
 * @fileoverview Unit tests for Linux system metrics parser and collector helpers.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SystemMetricsService } from "../system-metrics.service";

describe("SystemMetricsService", () => {
  test("parses /proc/net/dev payload and ignores loopback", () => {
    /* Network totals should include real interfaces only to avoid localhost noise. */
    const payload = [
      "Inter-|   Receive                                                |  Transmit",
      " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed",
      "    lo: 1200 0 0 0 0 0 0 0 2200 0 0 0 0 0 0 0",
      "  eth0: 5000 0 0 0 0 0 0 0 7000 0 0 0 0 0 0 0",
      "  wlan0: 3000 0 0 0 0 0 0 0 9000 0 0 0 0 0 0 0"
    ].join("\n");

    const parsed = SystemMetricsService.parseProcNetDev(payload);

    expect(parsed).toEqual({
      interfaces: 2,
      rxBytes: 8000,
      txBytes: 16000
    });
  });

  test("reads network stats from custom proc file path", async () => {
    /* Collector should read from configured path so tests stay hermetic. */
    const tempDir = await mkdtemp(join(tmpdir(), "rvs-system-metrics-"));
    const procPath = join(tempDir, "proc-net-dev");
    await writeFile(
      procPath,
      [
        "Inter-|   Receive                                                |  Transmit",
        " face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed",
        "  eth0: 4096 0 0 0 0 0 0 0 2048 0 0 0 0 0 0 0"
      ].join("\n"),
      "utf-8"
    );

    const service = new SystemMetricsService(
      { projectsRoot: process.cwd() } as never,
      {
        now: () => 1700000000000,
        readProcNetDev: () => readFile(procPath, "utf-8"),
        getFsStats: async () => ({
          type: 0,
          bsize: 4096,
          blocks: 100,
          bfree: 40,
          bavail: 35,
          files: 10,
          ffree: 5
        })
      }
    );

    const snapshot = await service.getSnapshot();

    expect(snapshot.capturedAt).toBe("2023-11-14T22:13:20.000Z");
    expect(snapshot.network).toEqual({
      interfaces: 1,
      rxBytes: 4096,
      txBytes: 2048
    });

    await rm(tempDir, { recursive: true, force: true });
  });
});
