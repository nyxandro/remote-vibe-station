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
    /* Persist explicit disabled flag with POSIX tools because the CLIProxy image does not ship Python/Node. */
    const filePath = this.validateAuthFilePath(input.filePath);
    const disabledLiteral = input.disabled ? "true" : "false";
    const quotedPath = this.shellQuote(filePath);
    const awkProgram = this.shellQuote([
      'BEGIN { replaced = 0 }',
      '{',
      '  current = $0',
      '  if (replaced == 0) {',
      '    if (sub(/"disabled"[[:space:]]*:[[:space:]]*(true|false)/, "\\\"disabled\\\":" disabled, current)) {',
      '      replaced = 1',
      '    }',
      '  }',
      '  print current',
      '}',
      'END { if (replaced == 0) { exit 2 } }'
    ].join(" "));
    await this.execShell(
      [
        `path=${quotedPath}`,
        'tmp="$(mktemp "${path}.XXXXXX.tmp")"',
        '[ -f "$path" ] || { echo "auth file not found: $path" >&2; exit 1; }',
        `awk -v disabled=${this.shellQuote(disabledLiteral)} ${awkProgram} "$path" > "$tmp" || { status=$?; rm -f -- "$tmp"; exit "$status"; }`,
        'mv -- "$tmp" "$path"',
        'test ! -e "$tmp"'
      ].join(" && ")
    );
  }

  public async deleteFile(input: { filePath: string }): Promise<void> {
    /* Delete persisted auth file with portable shell commands available in the running CLIProxy image. */
    const filePath = this.validateAuthFilePath(input.filePath);
    const quotedPath = this.shellQuote(filePath);
    await this.execShell(
      [`path=${quotedPath}`, '[ -f "$path" ] || { echo "auth file not found: $path" >&2; exit 1; }', 'rm -f -- "$path"'].join(
        " && "
      )
    );
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

  private shellQuote(value: string): string {
    /* Runtime paths are already validated, but shell quoting keeps composed exec commands deterministic. */
    return `'${value.replaceAll("'", `'\\''`)}'`;
  }

  private async execShell(command: string): Promise<void> {
    /* Reuse plain shell execution because the CLIProxy image only guarantees POSIX userland tools. */
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
      command
    ];
    await this.dockerCompose.run(args, runtimeConfigDir);
  }
}
