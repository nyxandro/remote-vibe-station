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

  it("rejects in-place runtime updates when immutable images are required", async () => {
    /* Update action must fail fast with operator guidance instead of mutating the running container. */
    const service = new OpenCodeRuntimeService();
    jest.spyOn(service, "checkVersionStatus").mockResolvedValue({
      currentVersion: "1.0.0",
      latestVersion: "1.0.1",
      latestCheckedAt: "2026-03-17T00:00:00.000Z",
      updateAvailable: true
    });

    await expect(service.updateToLatestVersion()).rejects.toThrow(
      "APP_OPENCODE_IMMUTABLE_UPDATE_REQUIRED"
    );
  });
});
