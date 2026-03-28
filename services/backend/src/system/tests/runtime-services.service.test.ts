/**
 * @fileoverview Unit tests for runtime service dashboard health and restart logic.
 */

import { RuntimeServicesService } from "../runtime-services.service";

describe("RuntimeServicesService", () => {
  test("marks running services healthy when probes succeed", async () => {
    /* Dashboard should expose uptime and healthy probe state for responsive services. */
    const nowMs = Date.parse("2026-03-28T12:00:00.000Z");
    const service = new RuntimeServicesService({
      now: () => nowMs,
      runDocker: jest
        .fn()
        .mockImplementation(async (args: string[]) => {
          if (args[0] === "ps") {
            const composeService = args[3].replace("label=com.docker.compose.service=", "");
            return `remote-vibe-station-${composeService}-1\n`;
          }

          const composeService = args[1].replace("remote-vibe-station-", "").replace(/-1$/, "");
          return JSON.stringify([
            {
              Name: `/remote-vibe-station-${composeService}-1`,
              State: {
                Status: "running",
                Running: true,
                Restarting: false,
                StartedAt: "2026-03-28T11:55:00.000Z",
                Health: { Status: "healthy", Log: [] }
              }
            }
          ]);
        }),
      probe: jest.fn().mockResolvedValue({ ok: true, statusCode: 200, latencyMs: 45, errorCode: null })
    });

    const snapshot = await service.getSnapshot();
    const opencode = snapshot.services.find((item) => item.id === "opencode");

    expect(snapshot.services).toHaveLength(4);
    expect(opencode).toMatchObject({
      id: "opencode",
      health: "healthy",
      containerStatus: "running",
      uptimeSeconds: 300,
      message: "Service is responding normally."
    });
  });

  test("marks service degraded when container is running but live probe fails", async () => {
    /* Operators should see partial outage instead of a fake healthy state when HTTP endpoint stops responding. */
    const service = new RuntimeServicesService({
      now: () => Date.parse("2026-03-28T12:00:00.000Z"),
      runDocker: jest
        .fn()
        .mockImplementation(async (args: string[]) => {
          if (args[0] === "ps") {
            const composeService = args[3].replace("label=com.docker.compose.service=", "");
            return composeService === "miniapp" ? "remote-vibe-station-miniapp-1\n" : "";
          }

          return JSON.stringify([
            {
              Name: "/remote-vibe-station-miniapp-1",
              State: {
                Status: "running",
                Running: true,
                Restarting: false,
                StartedAt: "2026-03-28T11:59:00.000Z"
              }
            }
          ]);
        }),
      probe: jest.fn().mockResolvedValue({ ok: false, statusCode: 502, latencyMs: 120, errorCode: null })
    });

    const snapshot = await service.getSnapshot();
    const miniapp = snapshot.services.find((item) => item.id === "miniapp");
    const bot = snapshot.services.find((item) => item.id === "bot");

    expect(miniapp).toMatchObject({
      health: "degraded",
      message: "Service is running, but the live probe failed: HTTP 502."
    });
    expect(bot).toMatchObject({
      health: "down",
      containerStatus: "missing",
      actions: { canRestart: false }
    });
  });

  test("restarts every container belonging to the selected service", async () => {
    /* Service restart action should target only the requested compose service containers. */
    const runDocker = jest.fn().mockImplementation(async (args: string[]) => {
      if (args[0] === "ps") {
        return "remote-vibe-station-opencode-1\nremote-vibe-station-opencode-2\n";
      }

      return "restarted";
    });
    const service = new RuntimeServicesService({
      now: () => Date.now(),
      runDocker,
      probe: jest.fn()
    });

    const result = await service.restartService("opencode");

    expect(result).toEqual({
      restarted: ["remote-vibe-station-opencode-1", "remote-vibe-station-opencode-2"]
    });
    expect(runDocker).toHaveBeenNthCalledWith(
      1,
      ["ps", "-a", "--filter", "label=com.docker.compose.service=opencode", "--format", "{{.Names}}"]
    );
    expect(runDocker).toHaveBeenNthCalledWith(2, ["restart", "remote-vibe-station-opencode-1"]);
    expect(runDocker).toHaveBeenNthCalledWith(3, ["restart", "remote-vibe-station-opencode-2"]);
  });
});
