/**
 * @fileoverview Tests for GitHub PAT JSON store persistence behavior.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { GithubAppStore } from "../github-app.store";

describe("GithubAppStore", () => {
  test("stores, masks, and deletes global PAT", () => {
    /* Use isolated cwd so the PAT store never touches the real backend runtime data directory. */
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "github-token-store-"));
    const previousCwd = process.cwd();
    process.chdir(tmpRoot);

    try {
      const store = new GithubAppStore();
      store.saveToken({
        adminId: 777,
        token: "github_pat_example123456",
        updatedAt: "2036-01-01T10:00:00.000Z"
      });

      expect(store.getToken()).toEqual({
        adminId: 777,
        token: "github_pat_example123456",
        tokenPreview: "gith...3456",
        updatedAt: "2036-01-01T10:00:00.000Z"
      });

      store.deleteToken();
      expect(store.getToken()).toBeNull();
    } finally {
      process.chdir(previousCwd);
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
