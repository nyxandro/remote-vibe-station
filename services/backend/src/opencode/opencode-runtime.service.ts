/**
 * @fileoverview Runtime controls for OpenCode docker service.
 *
 * Exports:
 * - OpenCodeRuntimeService (L17) - Restarts running OpenCode compose containers.
 */

import { Injectable } from "@nestjs/common";
import { spawn } from "node:child_process";

@Injectable()
export class OpenCodeRuntimeService {
  public async restartServiceContainers(): Promise<{ restarted: string[] }> {
    /* Restart all compose containers labeled as service=opencode. */
    const namesRaw = await this.runDocker([
      "ps",
      "--filter",
      "label=com.docker.compose.service=opencode",
      "--format",
      "{{.Names}}"
    ]);
    const names = namesRaw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (names.length === 0) {
      throw new Error("OpenCode container is not running");
    }

    for (const name of names) {
      await this.runDocker(["restart", name]);
    }

    return { restarted: names };
  }

  private async runDocker(args: string[]): Promise<string> {
    /* Execute docker command and return stdout text. */
    return new Promise((resolve, reject) => {
      const child = spawn("docker", args);
      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => reject(error));
      child.on("close", (code) => {
        if ((code ?? 1) !== 0) {
          reject(new Error(`docker ${args.join(" ")} failed: ${stderr}`));
          return;
        }
        resolve(stdout);
      });
    });
  }
}
