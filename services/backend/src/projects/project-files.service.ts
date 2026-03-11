/**
 * @fileoverview File tree and file reading utilities scoped to a project.
 *
 * Exports:
 * - ProjectFilesService (L28) - Lists folders and reads text files safely.
 * - ProjectFileWriteResult (L25) - Persisted file metadata returned after upload/import actions.
 * - PROJECT_FILE_UPLOAD_LIMIT_BYTES (L18) - Shared byte limit for device uploads and URL imports.
 */

import { lookup } from "node:dns/promises";
import * as fs from "node:fs";
import { isIP } from "node:net";
import * as path from "node:path";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { assertWithinRoot } from "./project-paths";

const DEFAULT_IGNORED_NAMES = [".git", "node_modules", ".next", "dist", "build"];
const MAX_TEXT_BYTES = 256 * 1024;
export const PROJECT_FILE_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const CONTENT_LENGTH_HEADER = "content-length";
const LOCATION_HEADER = "location";
const HTTP_PROTOCOLS = new Set(["http:", "https:"]);
const MAX_REDIRECTS = 5;
const LOCAL_HOST_NAMES = new Set(["localhost", "localhost."]);

export type FileEntry = {
  name: string;
  kind: "file" | "dir";
  sizeBytes?: number;
};

export type ProjectFileWriteResult = {
  path: string;
  name: string;
  sizeBytes: number;
};

@Injectable()
export class ProjectFilesService {
  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {}

  public list(projectRootPath: string, relativePath: string | undefined): FileEntry[] {
    /*
     * Resolve path within the project and list immediate children.
     * We keep it shallow to avoid performance issues and surprising scans.
     */
    const safeRelativePath = relativePath ?? "";
    const abs = path.resolve(projectRootPath, safeRelativePath);

    assertWithinRoot(this.config.projectsRoot, abs);
    assertWithinRoot(projectRootPath, abs);

    const stat = fs.statSync(abs);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${safeRelativePath || "."}`);
    }

    const entries = fs.readdirSync(abs, { withFileTypes: true });
    const ignored = new Set(DEFAULT_IGNORED_NAMES);

    return entries
      .filter((e) => !ignored.has(e.name))
      .map((e): FileEntry => {
        /* Keep literal union type for kind to satisfy TS. */
        const kind: FileEntry["kind"] = e.isDirectory() ? "dir" : "file";

        /* File list rows expose byte size only for files so Mini App can render human-readable sizes. */
        if (kind === "file") {
          const entryPath = path.join(abs, e.name);
          const entryStat = fs.statSync(entryPath);
          return { name: e.name, kind, sizeBytes: entryStat.size };
        }

        return { name: e.name, kind };
      })
      .sort((a, b) => {
        /* Directories first, then files, stable by name. */
        if (a.kind !== b.kind) {
          return a.kind === "dir" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
  }

  public readText(projectRootPath: string, relativeFilePath: string): string {
    /*
     * Read a text file with a hard size limit.
     * This endpoint is for UI inspection, not binary downloads.
     */
    const abs = path.resolve(projectRootPath, relativeFilePath);
    assertWithinRoot(this.config.projectsRoot, abs);
    assertWithinRoot(projectRootPath, abs);

    const stat = fs.statSync(abs);
    if (!stat.isFile()) {
      throw new Error(`Not a file: ${relativeFilePath}`);
    }

    if (stat.size > MAX_TEXT_BYTES) {
      throw new Error(`File too large to preview (${stat.size} bytes)`);
    }

    return fs.readFileSync(abs, "utf-8");
  }

  public readDownloadFile(projectRootPath: string, relativeFilePath: string): { fileName: string; content: Buffer } {
    /* Download flow should stream the raw file bytes while preserving the original file name. */
    const abs = this.resolveFilePath(projectRootPath, relativeFilePath);
    return {
      fileName: path.basename(abs),
      content: fs.readFileSync(abs)
    };
  }

  public writeUploadedFile(
    projectRootPath: string,
    relativeDirectoryPath: string | undefined,
    input: { fileName: string; content: Buffer }
  ): ProjectFileWriteResult {
    /* Device uploads write the received buffer directly into the current folder without overwriting existing files. */
    return this.writeFile(projectRootPath, relativeDirectoryPath, {
      fileName: input.fileName,
      content: input.content
    });
  }

  public async importFileFromUrl(
    projectRootPath: string,
    relativeDirectoryPath: string | undefined,
    url: string
  ): Promise<ProjectFileWriteResult> {
    /* External imports download bytes first, then persist them through the same guarded write path as device uploads. */
    if (!URL.canParse(url)) {
      throw new Error("Invalid file URL");
    }

    const parsed = new URL(url);
    if (!HTTP_PROTOCOLS.has(parsed.protocol)) {
      throw new Error("Only http/https URLs are supported");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    const response = await this.fetchExternalFile(parsed, controller.signal).finally(() => {
      clearTimeout(timeout);
    });

    if (!response.ok) {
      throw new Error(`File download failed: ${response.status}`);
    }

    const contentLength = response.headers.get(CONTENT_LENGTH_HEADER);
    if (contentLength) {
      const parsedLength = Number(contentLength);
      if (Number.isFinite(parsedLength) && parsedLength > PROJECT_FILE_UPLOAD_LIMIT_BYTES) {
        throw new Error(`File is too large to import (${parsedLength} bytes)`);
      }
    }

    const fileName = this.extractFileNameFromUrl(response.url || url);
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length > PROJECT_FILE_UPLOAD_LIMIT_BYTES) {
      throw new Error(`File is too large to import (${content.length} bytes)`);
    }

    return this.writeFile(projectRootPath, relativeDirectoryPath, { fileName, content });
  }

  private writeFile(
    projectRootPath: string,
    relativeDirectoryPath: string | undefined,
    input: { fileName: string; content: Buffer }
  ): ProjectFileWriteResult {
    /* Shared write path keeps local uploads and URL imports identical in validation and persistence behavior. */
    const directoryPath = this.resolveDirectoryPath(projectRootPath, relativeDirectoryPath);
    const safeFileName = this.normalizeFileName(input.fileName);
    const targetPath = path.join(directoryPath, safeFileName);

    if (input.content.length > PROJECT_FILE_UPLOAD_LIMIT_BYTES) {
      throw new Error(`File is too large to store (${input.content.length} bytes)`);
    }

    this.assertPathWithinRoots(projectRootPath, targetPath);
    fs.writeFileSync(targetPath, input.content, { flag: "wx" });
    return {
      path: this.buildRelativeResultPath(relativeDirectoryPath, safeFileName),
      name: safeFileName,
      sizeBytes: input.content.length
    };
  }

  private resolveDirectoryPath(projectRootPath: string, relativeDirectoryPath: string | undefined): string {
    /* Upload/import targets must point to an existing project directory, never to an arbitrary filesystem location. */
    const safeRelativePath = relativeDirectoryPath ?? "";
    const abs = path.resolve(projectRootPath, safeRelativePath);

    this.assertPathWithinRoots(projectRootPath, abs);

    const stat = fs.statSync(abs);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${safeRelativePath || "."}`);
    }

    return abs;
  }

  private resolveFilePath(projectRootPath: string, relativeFilePath: string): string {
    /* Download targets must resolve to an existing file inside the selected project root. */
    const abs = path.resolve(projectRootPath, relativeFilePath);
    this.assertPathWithinRoots(projectRootPath, abs);

    const stat = fs.statSync(abs);
    if (!stat.isFile()) {
      throw new Error(`Not a file: ${relativeFilePath}`);
    }

    return abs;
  }

  private assertPathWithinRoots(projectRootPath: string, targetPath: string): void {
    /* Every file operation must stay inside both PROJECTS_ROOT and the concrete selected project root. */
    assertWithinRoot(this.config.projectsRoot, targetPath);
    assertWithinRoot(projectRootPath, targetPath);
  }

  private normalizeFileName(fileName: string): string {
    /* File names are reduced to a single basename so uploads cannot smuggle nested or parent paths. */
    const normalized = path.basename(fileName.trim());
    if (!normalized || normalized === "." || normalized === "..") {
      throw new Error("File name is required");
    }

    return normalized;
  }

  private extractFileNameFromUrl(url: string): string {
    /* Imported files derive their final name from the resolved response URL, including redirects. */
    const parsed = new URL(url);
    let lastSegment = path.posix.basename(parsed.pathname);
    try {
      lastSegment = decodeURIComponent(lastSegment);
    } catch {
      /* Keep raw basename when URL path contains malformed percent-encoding. */
    }
    return this.normalizeFileName(lastSegment);
  }

  private async fetchExternalFile(url: URL, signal: AbortSignal): Promise<Response> {
    /* Follow redirects manually so every hop can be validated against private-network SSRF rules. */
    let currentUrl = new URL(url.toString());

    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      await this.assertRemoteHostIsPublic(currentUrl);
      const response = await fetch(currentUrl, {
        redirect: "manual",
        signal
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get(LOCATION_HEADER);
        if (!location) {
          throw new Error("File download redirect is missing Location header");
        }

        currentUrl = new URL(location, currentUrl);
        continue;
      }

      return response;
    }

    throw new Error("Too many redirects while downloading file");
  }

  private async assertRemoteHostIsPublic(url: URL): Promise<void> {
    /* Reject localhost/private destinations so external file import cannot be used as an SSRF tunnel. */
    const hostname = url.hostname.trim().toLowerCase();
    if (!hostname) {
      throw new Error("File URL host is required");
    }

    if (LOCAL_HOST_NAMES.has(hostname)) {
      throw new Error("Refusing to download from local or private network host");
    }

    const addresses = isIP(hostname)
      ? [hostname]
      : (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

    if (addresses.length === 0) {
      throw new Error("Could not resolve file URL host");
    }

    if (addresses.some((address) => this.isPrivateAddress(address))) {
      throw new Error("Refusing to download from local or private network host");
    }
  }

  private isPrivateAddress(address: string): boolean {
    /* Treat loopback, link-local, RFC1918, ULA, and IPv4-mapped private ranges as non-public destinations. */
    const normalized = address.toLowerCase();
    const mappedIpv4 = normalized.startsWith("::ffff:") ? normalized.slice(7) : normalized;
    const family = isIP(mappedIpv4);

    if (family === 4) {
      const octets = mappedIpv4.split(".").map((segment) => Number(segment));
      const [first = 0, second = 0] = octets;
      return (
        first === 0 ||
        first === 10 ||
        first === 127 ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168)
      );
    }

    if (family === 6) {
      return (
        normalized === "::" ||
        normalized === "::1" ||
        normalized.startsWith("fc") ||
        normalized.startsWith("fd") ||
        normalized.startsWith("fe8") ||
        normalized.startsWith("fe9") ||
        normalized.startsWith("fea") ||
        normalized.startsWith("feb")
      );
    }

    throw new Error(`Unsupported IP address: ${address}`);
  }

  private buildRelativeResultPath(relativeDirectoryPath: string | undefined, fileName: string): string {
    /* API responses should always use forward slashes so Mini App paths stay platform-agnostic. */
    const normalizedDirectory = (relativeDirectoryPath ?? "").trim().replace(/^\/+|\/+$/g, "");
    return normalizedDirectory ? path.posix.join(normalizedDirectory, fileName) : fileName;
  }
}
