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
});
