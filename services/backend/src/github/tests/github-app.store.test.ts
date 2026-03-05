/**
 * @fileoverview Tests for GitHub App JSON store persistence behavior.
 *
 * Exports:
 * - (none)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { GithubAppStore } from "../github-app.store";

describe("GithubAppStore", () => {
  test("creates pending state and stores installation mapping", () => {
    /* Use isolated cwd so store writes only into temporary test data directory. */
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "github-app-store-"));
    const previousCwd = process.cwd();
    process.chdir(tmpRoot);

    try {
      const store = new GithubAppStore();
      const state = "state-abc";
      const now = new Date("2036-01-01T10:00:00.000Z").toISOString();
      const expiresAt = new Date("2036-01-01T10:15:00.000Z").toISOString();

      store.savePendingState({ state, adminId: 777, createdAt: now, expiresAt });
      const pending = store.consumePendingState(state);
      expect(pending?.adminId).toBe(777);
      expect(store.consumePendingState(state)).toBeNull();

      store.saveInstallation({
        adminId: 777,
        installationId: 123456,
        accountLogin: "my-org",
        accountType: "Organization",
        connectedAt: now
      });

      const status = store.getInstallation(777);
      expect(status?.installationId).toBe(123456);
      expect(status?.accountLogin).toBe("my-org");
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
