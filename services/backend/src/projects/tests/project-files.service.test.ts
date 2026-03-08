/**
 * @fileoverview Tests for ProjectFilesService file listing metadata.
 *
 * Exports:
 * - (none)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ProjectFilesService } from "../project-files.service";

describe("ProjectFilesService", () => {
  test("returns file sizes for file entries while keeping directories size-less", () => {
    /* File explorer needs exact file sizes, but directory rows should not pretend to have a file byte count. */
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-project-files-"));
    const projectRoot = path.join(tmpRoot, "demo");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.mkdirSync(path.join(projectRoot, "docs"));
    fs.writeFileSync(path.join(projectRoot, "readme.md"), "hello");

    try {
      const service = new ProjectFilesService({ projectsRoot: tmpRoot } as never);

      const entries = service.list(projectRoot, "");

      expect(entries).toEqual([
        { name: "docs", kind: "dir" },
        { name: "readme.md", kind: "file", sizeBytes: 5 }
      ]);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
