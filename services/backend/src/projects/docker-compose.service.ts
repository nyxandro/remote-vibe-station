/**
 * @fileoverview Wrapper for running docker compose commands.
 *
 * Exports:
 * - CommandResult (L12) - Output from docker compose commands.
 * - DockerComposeService (L19) - Executes docker compose with args.
 */

import { Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

@Injectable()
export class DockerComposeService {
  public async run(args: string[], cwd: string): Promise<CommandResult> {
    /* Execute docker compose and capture output. */
    return new Promise((resolve, reject) => {
      const child = spawn("docker", ["compose", ...args], { cwd });
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        const exitCode = code ?? 1;
        if (exitCode !== 0) {
          reject(new Error(`docker compose failed: ${stderr}`));
          return;
        }
        resolve({ exitCode, stdout, stderr });
      });
    });
  }
}
