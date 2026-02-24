/**
 * @fileoverview Tests for project workspace folder creation collision handling.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ProjectWorkspaceService } from "../project-workspace.service";

describe("ProjectWorkspaceService.createProjectFolder", () => {
  let root: string;

  beforeEach(() => {
    /* Use isolated tmp workspace to safely create/remove test folders. */
    root = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-service-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  test("retries with suffix when mkdir hits EEXIST race", () => {
    /* Simulate TOCTOU: target appears after uniqueness check but before mkdir call. */
    const service = new ProjectWorkspaceService({ projectsRoot: root } as any);
    const originalMkdirSync = fs.mkdirSync;
    let firstCall = true;

    jest.spyOn(fs, "mkdirSync").mockImplementation(((targetPath: fs.PathLike, options?: fs.MakeDirectoryOptions) => {
      if (firstCall) {
        firstCall = false;
        originalMkdirSync(targetPath, options);
        const existsError = new Error("EEXIST") as NodeJS.ErrnoException;
        existsError.code = "EEXIST";
        throw existsError;
      }
      return originalMkdirSync(targetPath, options);
    }) as typeof fs.mkdirSync);

    const created = service.createProjectFolder("Arena");

    expect(created.slug).toBe("arena-2");
    expect(fs.existsSync(path.join(root, "arena"))).toBe(true);
    expect(fs.existsSync(path.join(root, "arena-2"))).toBe(true);
  });

  test("rethrows non-EEXIST mkdir errors", () => {
    /* Fail fast on unexpected filesystem failures instead of masking root cause. */
    const service = new ProjectWorkspaceService({ projectsRoot: root } as any);
    const permissionError = new Error("EPERM") as NodeJS.ErrnoException;
    permissionError.code = "EPERM";

    jest.spyOn(fs, "mkdirSync").mockImplementation(() => {
      throw permissionError;
    });

    expect(() => service.createProjectFolder("Arena")).toThrow("EPERM");
  });
});
