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

  test("writes an uploaded file into the requested project folder", () => {
    /* Device uploads should land inside the currently opened folder without escaping project root. */
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-project-files-upload-"));
    const projectRoot = path.join(tmpRoot, "demo");
    fs.mkdirSync(path.join(projectRoot, "public", "uploads"), { recursive: true });

    try {
      const service = new ProjectFilesService({ projectsRoot: tmpRoot } as never);

      const result = service.writeUploadedFile(projectRoot, "public/uploads", {
        fileName: "logo.svg",
        content: Buffer.from("<svg></svg>", "utf8")
      });

      expect(result).toEqual({
        path: "public/uploads/logo.svg",
        name: "logo.svg",
        sizeBytes: 11
      });
      expect(fs.readFileSync(path.join(projectRoot, "public", "uploads", "logo.svg"), "utf8")).toBe("<svg></svg>");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("downloads a file by URL into the requested folder", async () => {
    /* External URL imports should persist the downloaded bytes under a filename derived from the source URL. */
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-project-files-url-"));
    const projectRoot = path.join(tmpRoot, "demo");
    fs.mkdirSync(path.join(projectRoot, "public", "uploads"), { recursive: true });

    const fetchMock = jest.fn(async () => {
      return {
        ok: true,
        url: "https://93.184.216.34/assets/archive.txt",
        headers: new Headers({ "content-length": "4" }),
        arrayBuffer: async () => Buffer.from("demo", "utf8")
      } as unknown as Response;
    });
    const previousFetch = global.fetch;
    global.fetch = fetchMock as typeof global.fetch;

    try {
      const service = new ProjectFilesService({ projectsRoot: tmpRoot } as never);

      const result = await service.importFileFromUrl(projectRoot, "public/uploads", "https://93.184.216.34/assets/archive.txt");

      expect(fetchMock).toHaveBeenCalledWith(expect.any(URL), expect.any(Object));
      expect(result).toEqual({
        path: "public/uploads/archive.txt",
        name: "archive.txt",
        sizeBytes: 4
      });
      expect(fs.readFileSync(path.join(projectRoot, "public", "uploads", "archive.txt"), "utf8")).toBe("demo");
    } finally {
      global.fetch = previousFetch;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("rejects URL imports from local or private network hosts", async () => {
    /* File import must not become an SSRF tunnel into localhost or RFC1918 network ranges. */
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-project-files-private-url-"));
    const projectRoot = path.join(tmpRoot, "demo");
    fs.mkdirSync(path.join(projectRoot, "public", "uploads"), { recursive: true });

    const fetchMock = jest.fn();
    const previousFetch = global.fetch;
    global.fetch = fetchMock as typeof global.fetch;

    try {
      const service = new ProjectFilesService({ projectsRoot: tmpRoot } as never);

      await expect(
        service.importFileFromUrl(projectRoot, "public/uploads", "http://127.0.0.1/private.txt")
      ).rejects.toThrow("Refusing to download from local or private network host");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      global.fetch = previousFetch;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
