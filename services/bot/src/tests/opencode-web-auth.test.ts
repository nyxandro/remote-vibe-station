/**
 * @fileoverview Tests for JSON-backed OpenCode web auth state.
 *
 * Exports:
 * - (none)
 *
 * Tests:
 * - OpenCodeWebAuthService.issueMagicLink (L46) - Creates one-time short-lived links.
 * - OpenCodeWebAuthService.exchangeMagicLink (L58) - Consumes link and creates session.
 * - OpenCodeWebAuthService.verifySession (L75) - Validates fingerprint + TTL.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { OpenCodeWebAuthService } from "../opencode-web-auth";

const LINK_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

describe("OpenCodeWebAuthService", () => {
  let tempDir: string;
  let nowMs: number;

  const createService = (): OpenCodeWebAuthService => {
    /* Create service with deterministic time source for TTL tests. */
    return new OpenCodeWebAuthService({
      storageFilePath: path.join(tempDir, "opencode-web-auth.json"),
      linkTtlMs: LINK_TTL_MS,
      sessionTtlMs: SESSION_TTL_MS,
      now: () => nowMs
    });
  };

  beforeEach(async () => {
    /* Isolate filesystem state per test. */
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-web-auth-"));
    nowMs = Date.parse("2026-02-24T12:00:00.000Z");
  });

  afterEach(async () => {
    /* Cleanup temporary files after test completion. */
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("issues one-time magic link and consumes it exactly once", async () => {
    /* Link should be valid for first exchange and rejected on replay. */
    const service = createService();
    const token = await service.issueMagicLink({ adminId: 777 });

    const session = await service.exchangeMagicLink({
      token,
      fingerprint: "Mozilla/5.0|203.0.113"
    });

    expect(session.adminId).toBe(777);
    await expect(
      service.exchangeMagicLink({
        token,
        fingerprint: "Mozilla/5.0|203.0.113"
      })
    ).rejects.toThrow("Magic link is invalid or expired");
  });

  it("rejects expired magic links", async () => {
    /* Short-lived links must fail after TTL window. */
    const service = createService();
    const token = await service.issueMagicLink({ adminId: 777 });

    nowMs += LINK_TTL_MS + 1;
    await expect(
      service.exchangeMagicLink({
        token,
        fingerprint: "Mozilla/5.0|203.0.113"
      })
    ).rejects.toThrow("Magic link is invalid or expired");
  });

  it("keeps session valid for 30 days on same device fingerprint", async () => {
    /* Session cookie may live long, but should be tied to device fingerprint. */
    const service = createService();
    const token = await service.issueMagicLink({ adminId: 777 });
    const exchanged = await service.exchangeMagicLink({
      token,
      fingerprint: "Mozilla/5.0|203.0.113"
    });

    nowMs += 29 * 24 * 60 * 60 * 1000;
    const stillValid = await service.verifySession({
      sessionId: exchanged.sessionId,
      fingerprint: "Mozilla/5.0|203.0.113"
    });
    expect(stillValid).toEqual({ adminId: 777 });

    const wrongFingerprint = await service.verifySession({
      sessionId: exchanged.sessionId,
      fingerprint: "Mozilla/5.0|198.51.100"
    });
    expect(wrongFingerprint).toBeNull();

    nowMs += 2 * 24 * 60 * 60 * 1000;
    const expired = await service.verifySession({
      sessionId: exchanged.sessionId,
      fingerprint: "Mozilla/5.0|203.0.113"
    });
    expect(expired).toBeNull();
  });
});
