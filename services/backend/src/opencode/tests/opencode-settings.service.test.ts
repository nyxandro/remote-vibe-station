/**
 * @fileoverview Tests for OpenCode settings service env-file discovery and access control.
 *
 * Exports:
 * - none (Jest test suite).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { OpenCodeSettingsService } from "../opencode-settings.service";

const writeText = (absolutePath: string, content: string): void => {
  /* Build test fixtures with nested directories. */
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content, "utf-8");
};

describe("OpenCodeSettingsService", () => {
  test("does not include skills/plugins sections in overview", () => {
    /* Mini App settings intentionally excludes skills/plugins management. */
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-settings-"));

    try {
      const config = {
        projectsRoot: tmpRoot,
        opencodeConfigDir: path.join(tmpRoot, "opencode-config")
      };
      const projects = {
        getProjectRootPath: () => path.join(tmpRoot, "demo")
      };

      const service = new OpenCodeSettingsService(config as any, projects as any);
      const overview = service.getOverview(null) as Record<string, unknown>;

      expect(overview).not.toHaveProperty("skills");
      expect(overview).not.toHaveProperty("plugins");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("discovers env files from project root and ignores heavy folders", () => {
    /* Isolate project root for deterministic discovery behavior. */
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-settings-"));

    try {
      const projectRoot = path.join(tmpRoot, "demo");
      fs.mkdirSync(projectRoot, { recursive: true });

      writeText(path.join(projectRoot, ".env"), "A=1\n");
      writeText(path.join(projectRoot, ".env.local"), "B=2\n");
      writeText(path.join(projectRoot, "apps", "web", ".env.production"), "C=3\n");
      writeText(path.join(projectRoot, "deploy", "prod.env"), "D=4\n");
      writeText(path.join(projectRoot, ".envrc"), "export E=5\n");

      /* Must be ignored by scanner. */
      writeText(path.join(projectRoot, "node_modules", "pkg", ".env"), "NOPE=1\n");
      writeText(path.join(projectRoot, ".git", "hooks", ".env"), "NOPE=2\n");

      const config = {
        projectsRoot: tmpRoot,
        opencodeConfigDir: path.join(tmpRoot, "opencode-config")
      };
      const projects = {
        getProjectRootPath: (projectId: string) => {
          if (projectId !== "demo") {
            throw new Error("Unknown project");
          }
          return projectRoot;
        }
      };

      const service = new OpenCodeSettingsService(config as any, projects as any);
      const overview = service.getOverview("demo");
      const paths = (overview.projectEnvFiles ?? [])
        .map((item: { relativePath: string }) => item.relativePath)
        .sort();

      expect(paths).toEqual([
        ".env",
        ".env.local",
        ".envrc",
        "apps/web/.env.production",
        "deploy/prod.env"
      ]);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("allows only discovered env files for projectEnvFile read", () => {
    /* Ensure projectEnvFile kind cannot read arbitrary project files. */
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-settings-"));

    try {
      const projectRoot = path.join(tmpRoot, "demo");
      fs.mkdirSync(projectRoot, { recursive: true });

      writeText(path.join(projectRoot, ".env"), "OK=1\n");
      writeText(path.join(projectRoot, "package.json"), "{\"name\":\"demo\"}\n");

      const config = {
        projectsRoot: tmpRoot,
        opencodeConfigDir: path.join(tmpRoot, "opencode-config")
      };
      const projects = {
        getProjectRootPath: () => projectRoot
      };

      const service = new OpenCodeSettingsService(config as any, projects as any);
      const allowed = service.readFile("projectEnvFile", "demo", ".env");
      expect(allowed.exists).toBe(true);
      expect(allowed.content).toContain("OK=1");

      expect(() => service.readFile("projectEnvFile", "demo", "package.json")).toThrow(
        "Path is not a discovered env file"
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("lists global agents and commands from OpenCode config root", () => {
    /* Agents and commands should both live in global OpenCode config, not in project folders. */
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-settings-"));

    try {
      const projectRoot = path.join(tmpRoot, "demo");
      const configRoot = path.join(tmpRoot, "opencode-config");
      fs.mkdirSync(projectRoot, { recursive: true });

      writeText(path.join(configRoot, "agents", "reviewer.md"), "# reviewer\n");
      writeText(path.join(configRoot, "commands", "deploy.md"), "# deploy\n");
      writeText(path.join(projectRoot, ".opencode", "commands", "local-only.md"), "# local\n");

      const config = {
        projectsRoot: tmpRoot,
        opencodeConfigDir: configRoot
      };
      const projects = {
        getProjectRootPath: () => projectRoot
      };

      const service = new OpenCodeSettingsService(config as any, projects as any);
      const overview = service.getOverview("demo");

      expect(overview.agents).toEqual([{ name: "reviewer.md", relativePath: "reviewer.md" }]);
      expect(overview.commands).toEqual([{ name: "deploy.md", relativePath: "deploy.md" }]);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("creates and reads global command files without active project", () => {
    /* Global command management must work even when no project is selected in Mini App. */
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-settings-"));

    try {
      const configRoot = path.join(tmpRoot, "opencode-config");
      const config = {
        projectsRoot: tmpRoot,
        opencodeConfigDir: configRoot
      };
      const projects = {
        getProjectRootPath: () => path.join(tmpRoot, "demo")
      };

      const service = new OpenCodeSettingsService(config as any, projects as any);
      const created = service.createFile("command", null, "triage.md");
      expect(created.absolutePath).toBe(path.join(configRoot, "commands", "triage.md"));

      service.saveFile("command", null, "# triage\n", "triage.md");
      const loaded = service.readFile("command", null, "triage.md");
      expect(loaded.exists).toBe(true);
      expect(loaded.absolutePath).toBe(path.join(configRoot, "commands", "triage.md"));
      expect(loaded.content).toBe("# triage\n");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
