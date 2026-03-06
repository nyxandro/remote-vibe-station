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
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVE_SESSION_GRACE_MS = 5 * 60 * 1000;

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

  it("keeps session valid for 24 hours on same device fingerprint", async () => {
    /* Session must honor 24h absolute TTL before any post-expiry grace is considered. */
    const service = createService();
    const token = await service.issueMagicLink({ adminId: 777 });
    const exchanged = await service.exchangeMagicLink({
      token,
      fingerprint: "Mozilla/5.0|203.0.113"
    });
    const idleService = createService();
    const idleToken = await idleService.issueMagicLink({ adminId: 777 });
    const idleSession = await idleService.exchangeMagicLink({
      token: idleToken,
      fingerprint: "Mozilla/5.0|203.0.113"
    });

    nowMs += SESSION_TTL_MS - 1;
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

    nowMs += 2;
    const expired = await idleService.verifySession({
      sessionId: idleSession.sessionId,
      fingerprint: "Mozilla/5.0|203.0.113"
    });
    expect(expired).toBeNull();
  });

  it("keeps active session alive briefly after 24h while requests continue", async () => {
    /* Active work should survive the hard 24h mark, but only while traffic keeps arriving. */
    const service = createService();
    const token = await service.issueMagicLink({ adminId: 777 });
    const exchanged = await service.exchangeMagicLink({
      token,
      fingerprint: "Mozilla/5.0|203.0.113"
    });

    nowMs += SESSION_TTL_MS - 60_000;
    const activeBeforeExpiry = await service.verifySession({
      sessionId: exchanged.sessionId,
      fingerprint: "Mozilla/5.0|203.0.113"
    });
    expect(activeBeforeExpiry).toEqual({ adminId: 777 });

    nowMs += 60_001;
    const stillActive = await service.verifySession({
      sessionId: exchanged.sessionId,
      fingerprint: "Mozilla/5.0|203.0.113"
    });
    expect(stillActive).toEqual({ adminId: 777 });

    nowMs += ACTIVE_SESSION_GRACE_MS - 1;
    const renewedByActivity = await service.verifySession({
      sessionId: exchanged.sessionId,
      fingerprint: "Mozilla/5.0|203.0.113"
    });
    expect(renewedByActivity).toEqual({ adminId: 777 });

    nowMs += ACTIVE_SESSION_GRACE_MS + 1;
    const expiredAfterSilence = await service.verifySession({
      sessionId: exchanged.sessionId,
      fingerprint: "Mozilla/5.0|203.0.113"
    });
    expect(expiredAfterSilence).toBeNull();
  });
});
