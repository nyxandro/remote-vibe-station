/**
 * @fileoverview Tests for AdminHeaderGuard shared-secret protection.
 *
 * Exports:
 * - (none)
 */

import { UnauthorizedException } from "@nestjs/common";
import { ExecutionContext } from "@nestjs/common/interfaces";

import { AdminHeaderGuard } from "../admin-header.guard";

const makeContext = (request: any): ExecutionContext => {
  /* Keep guard tests focused on HTTP header parsing. */
  return {
    switchToHttp: () => ({
      getRequest: () => request
    })
  } as unknown as ExecutionContext;
};

describe("AdminHeaderGuard", () => {
  it("accepts requests with valid admin id and shared secret", () => {
    /* Bot/admin API must require both identity and internal shared secret. */
    const guard = new AdminHeaderGuard({
      adminIds: [649624756],
      botBackendAuthToken: "secret-token"
    } as never);

    const req: any = {
      headers: {
        "x-admin-id": "649624756",
        "x-bot-backend-token": "secret-token"
      }
    };

    expect(guard.canActivate(makeContext(req))).toBe(true);
    expect(req.authAdminId).toBe(649624756);
  });

  it("rejects requests without shared secret header", () => {
    /* Knowledge of admin id alone must not unlock internal endpoints. */
    const guard = new AdminHeaderGuard({
      adminIds: [649624756],
      botBackendAuthToken: "secret-token"
    } as never);

    const req: any = {
      headers: {
        "x-admin-id": "649624756"
      }
    };

    expect(() => guard.canActivate(makeContext(req))).toThrow(UnauthorizedException);
  });
});
