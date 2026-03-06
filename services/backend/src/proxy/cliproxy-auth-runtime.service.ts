/**
 * @fileoverview Runtime mutations for CLIProxy auth files via docker compose exec.
 *
 * Exports:
 * - CliproxyAuthRuntimeService (L22) - Enables/disables and deletes persisted CLIProxy auth files.
 */

import { BadRequestException, Injectable } from "@nestjs/common";
import * as path from "node:path";

import { DockerComposeService } from "../projects/docker-compose.service";

const RUNTIME_CONFIG_DIR_ENV = "RUNTIME_CONFIG_DIR";
const CLIPROXY_SERVICE_NAME = "cliproxy";
const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9._@+-]+$/;

@Injectable()
export class CliproxyAuthRuntimeService {
  public constructor(private readonly dockerCompose: DockerComposeService) {}

  public async setDisabled(input: { filePath: string; disabled: boolean }): Promise<void> {
    /* Persist explicit disabled flag inside auth JSON and let CLIProxy file watcher reload it. */
    const filePath = this.validateAuthFilePath(input.filePath);
    await this.execPython(`
import json
import os
import tempfile
from pathlib import Path

path = Path(${JSON.stringify(filePath)})
try:
    payload = json.loads(path.read_text(encoding="utf-8"))
except FileNotFoundError:
    raise FileNotFoundError(f"auth file not found: {path}")

payload["disabled"] = ${input.disabled ? "True" : "False"}
fd, temp_path = tempfile.mkstemp(prefix=f"{path.name}.", suffix=".tmp", dir=path.parent)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp_path, path)
    dir_fd = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(dir_fd)
    finally:
        os.close(dir_fd)
except Exception:
    try:
        os.unlink(temp_path)
    except FileNotFoundError:
        pass
    raise
`);
  }

  public async deleteFile(input: { filePath: string }): Promise<void> {
    /* Delete persisted auth file from CLIProxy volume so it disappears from the pool entirely. */
    const filePath = this.validateAuthFilePath(input.filePath);
    await this.execPython(`
from pathlib import Path

path = Path(${JSON.stringify(filePath)})
try:
    path.unlink()
except FileNotFoundError:
    raise FileNotFoundError(f"auth file not found: {path}")
`);
  }

  private validateAuthFilePath(filePath: string): string {
    /* Only absolute Linux JSON auth paths with safe path segments may be mutated inside cliproxy container. */
    const normalizedInput = typeof filePath === "string" ? filePath.trim() : "";
    if (!normalizedInput) {
      throw new BadRequestException("Auth file path is required");
    }
    if (normalizedInput.includes("\0") || normalizedInput.includes("\\")) {
      throw new BadRequestException("Auth file path contains forbidden characters");
    }

    const normalizedPath = path.posix.normalize(normalizedInput);
    if (!path.posix.isAbsolute(normalizedPath) || normalizedPath !== normalizedInput) {
      throw new BadRequestException("Auth file path must be an absolute normalized path");
    }
    if (!normalizedPath.endsWith(".json")) {
      throw new BadRequestException("Auth file path must point to a JSON auth file");
    }

    const segments = normalizedPath.split("/").filter(Boolean);
    if (segments.length === 0 || segments.some((segment) => !SAFE_PATH_SEGMENT_PATTERN.test(segment))) {
      throw new BadRequestException("Auth file path contains unsupported path segments");
    }

    return normalizedPath;
  }

  private async execPython(source: string): Promise<void> {
    /* Reuse cliproxy container Python to keep JSON edits deterministic and shell-safe. */
    const runtimeConfigDir = process.env[RUNTIME_CONFIG_DIR_ENV]?.trim() || "";
    if (!runtimeConfigDir) {
      throw new BadRequestException("RUNTIME_CONFIG_DIR is not configured in backend container");
    }

    const args = [
      "exec",
      "-T",
      CLIPROXY_SERVICE_NAME,
      "sh",
      "-lc",
      `python - <<'PY'\n${source.trim()}\nPY`
    ];
    await this.dockerCompose.run(args, runtimeConfigDir);
  }
}
