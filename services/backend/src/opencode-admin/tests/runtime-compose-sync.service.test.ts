/**
 * @fileoverview Tests for runtime compose toolbox sync.
 *
 * Exports:
 * - none.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { RuntimeComposeSyncService } from "../runtime-compose-sync.service";

describe("RuntimeComposeSyncService", () => {
  test("patches stale runtime compose with toolbox volume mount and declaration", async () => {
    /* Old installs missed shared toolbox persistence, so startup sync must self-heal them. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-compose-sync-"));
    const composePath = path.join(runtimeDir, "docker-compose.yml");

    /* Keep fixture close to the real stale server state: opencode has no /toolbox mount and root volumes miss toolbox_data. */
    fs.writeFileSync(
      composePath,
      [
        "services:",
        "  opencode:",
        "    image: example/opencode:latest",
        "    volumes:",
        "      - /var/run/docker.sock:/var/run/docker.sock",
        "      - ${PROJECTS_ROOT}:${PROJECTS_ROOT}",
        "      - /:/hostfs",
        "      - /root/.ssh:/root/.ssh",
        "      - /root/.config/gh:/root/.config/gh",
        "      - opencode_data:/root/.local/share/opencode",
        "      - opencode_config:/root/.config/opencode",
        "    labels:",
        "      - \"traefik.enable=true\"",
        "networks:",
        "  public:",
        "    driver: bridge",
        "volumes:",
        "  opencode_config:",
        "  backend_data:",
        "  opencode_data:",
        "  cliproxy_auth:",
        ""
      ].join("\n"),
      "utf-8"
    );

    const service = new RuntimeComposeSyncService();

    const result = await service.sync({ runtimeConfigDir: runtimeDir });

    const next = fs.readFileSync(composePath, "utf-8");
    expect(result.updated).toBe(true);
    expect(next).toContain("      - toolbox_data:/toolbox\n    labels:");
    expect(next).toContain("  toolbox_data:\n  cliproxy_auth:");
  });

  test("keeps current runtime compose unchanged when toolbox persistence already exists", async () => {
    /* Idempotence matters because startup sync may run on every backend restart. */
    const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-compose-sync-"));
    const composePath = path.join(runtimeDir, "docker-compose.yml");
    const content = [
      "services:",
      "  opencode:",
      "    image: example/opencode:latest",
      "    volumes:",
      "      - opencode_data:/root/.local/share/opencode",
      "      - opencode_config:/root/.config/opencode",
      "      - toolbox_data:/toolbox",
      "    labels:",
      "      - \"traefik.enable=true\"",
      "volumes:",
      "  opencode_data:",
      "  opencode_config:",
      "  toolbox_data:",
      ""
    ].join("\n");
    fs.writeFileSync(composePath, content, "utf-8");

    const service = new RuntimeComposeSyncService();

    const result = await service.sync({ runtimeConfigDir: runtimeDir });

    expect(result.updated).toBe(false);
    expect(fs.readFileSync(composePath, "utf-8")).toBe(content);
  });
});
