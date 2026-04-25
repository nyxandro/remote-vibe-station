/**
 * @fileoverview Tests for OpenCodeRuntimeService version-read resilience.
 *
 * Exports:
 * - (none)
 */

import { OpenCodeRuntimeService } from "../opencode-runtime.service";

describe("OpenCodeRuntimeService", () => {
  it("retries reading version while container is restarting", async () => {
    /* Update flow should tolerate short post-restart window before opencode is ready. */
    const service = new OpenCodeRuntimeService();
    const runDocker = jest
      .spyOn(service as any, "runDocker")
      .mockRejectedValueOnce(new Error("container is restarting"))
      .mockResolvedValueOnce("1.2.10");
    jest.spyOn(service as any, "sleep").mockResolvedValue(undefined);

    const version = await (service as any).readCurrentVersion({ containerNames: ["remote-vibe-station-opencode-1"] });

    expect(version).toBe("1.2.10");
    expect(runDocker).toHaveBeenCalledTimes(2);
  });

  it("force-updates toolbox install and restarts opencode containers", async () => {
    /* Manual update action should run the updater inside one container, then restart every OpenCode container. */
    const service = new OpenCodeRuntimeService();
    jest
      .spyOn(service, "checkVersionStatus")
      .mockResolvedValueOnce({
        currentVersion: "1.0.0",
        latestVersion: "1.0.1",
        latestCheckedAt: "2026-03-17T00:00:00.000Z",
        updateAvailable: true
      });

    jest.spyOn(service as any, "listOpenCodeContainerNames").mockResolvedValue([
      "remote-vibe-station-opencode-1",
      "remote-vibe-station-opencode-2"
    ]);

    const runDocker = jest.spyOn(service as any, "runDocker").mockResolvedValue("ok");

    jest.spyOn(service, "getVersionStatus").mockResolvedValue({
      currentVersion: "1.0.1",
      latestVersion: "1.0.1",
      latestCheckedAt: "2026-03-17T00:00:30.000Z",
      updateAvailable: false
    });

    await expect(service.updateToLatestVersion()).resolves.toEqual({
      updated: true,
      restarted: ["remote-vibe-station-opencode-1", "remote-vibe-station-opencode-2"],
      before: {
        currentVersion: "1.0.0",
        latestVersion: "1.0.1",
        latestCheckedAt: "2026-03-17T00:00:00.000Z",
        updateAvailable: true
      },
      after: {
        currentVersion: "1.0.1",
        latestVersion: "1.0.1",
        latestCheckedAt: "2026-03-17T00:00:30.000Z",
        updateAvailable: false
      }
    });

    expect(runDocker).toHaveBeenNthCalledWith(
      1,
      ["exec", "remote-vibe-station-opencode-1", "node", "/usr/local/bin/opencode-auto-update.js", "--force"]
    );
    expect(runDocker).toHaveBeenNthCalledWith(2, ["restart", "remote-vibe-station-opencode-1"]);
    expect(runDocker).toHaveBeenNthCalledWith(3, ["restart", "remote-vibe-station-opencode-2"]);
  });
});
