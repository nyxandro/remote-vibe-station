/**
 * @fileoverview Tests for runtime services controller update/version endpoints.
 *
 * Exports:
 * - RuntimeServicesController test suite - Verifies runtime version checks use explicit operator refresh semantics.
 */

import { Request } from "express";

import { RuntimeServicesController } from "../runtime-services.controller";

describe("RuntimeServicesController", () => {
  test("manual runtime version check bypasses release cache for authenticated admin", async () => {
    /* Operator-triggered checks must force a fresh GitHub release read so newly published versions appear immediately in Mini App. */
    const runtimeServices = {
      getSnapshot: jest.fn()
    };
    const runtimeUpdate = {
      checkLatestVersion: jest.fn().mockResolvedValue({ latestVersion: "0.2.12" })
    };
    const events = {
      publishWorkspaceEvent: jest.fn()
    };

    const controller = new RuntimeServicesController(runtimeServices as never, runtimeUpdate as never, events as never);
    const result = await controller.checkRuntimeVersion({ authAdminId: 649624756 } as unknown as Request);

    expect(runtimeUpdate.checkLatestVersion).toHaveBeenCalledWith({ forceRefresh: true });
    expect(result).toEqual({ latestVersion: "0.2.12" });
  });
});
