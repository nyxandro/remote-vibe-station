/**
 * @fileoverview OpenCode settings file browser/editor service for Mini App.
 *
 * Exports:
 * - OpenCodeSettingsKind (L16) - Editable settings groups.
 * - OpenCodeSettingsService (L52) - Lists, reads, saves, and creates OpenCode-related files.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { ProjectsService } from "../projects/projects.service";

export type OpenCodeSettingsKind =
  | "globalRule"
  | "projectRule"
  | "config"
  | "agent"
  | "command"
  | "skill"
  | "plugin";

type SettingsFileSummary = {
  name: string;
  relativePath: string;
};

type FileTarget = {
  absolutePath: string;
  baseDir: string;
};

type SettingsOverview = {
  globalRule: { exists: boolean; absolutePath: string };
  projectRule: { exists: boolean; absolutePath: string } | null;
  config: { exists: boolean; absolutePath: string };
  agents: SettingsFileSummary[];
  commands: SettingsFileSummary[];
  skills: SettingsFileSummary[];
  plugins: SettingsFileSummary[];
};

const ROOT_AGENTS_FILE = "AGENTS.md";
const OPENCODE_CONFIG_FILE = "opencode.json";
const AGENTS_DIR = "agents";
const SKILLS_DIR = "skills";
const PLUGINS_DIR = "plugins";
const PROJECT_OPENCODE_DIR = ".opencode";
const PROJECT_COMMANDS_DIR = "commands";
const DEFAULT_CONTAINER_CONFIG_DIR = "/root/.config/opencode";

@Injectable()
export class OpenCodeSettingsService {
  public constructor(
    @Inject(ConfigToken) private readonly config: AppConfig,
    private readonly projects: ProjectsService
  ) {}

  public getOverview(projectId: string | null): SettingsOverview {
    /* Build all file lists used by accordion sections in one backend roundtrip. */
    const globalRulePath = path.join(this.getOpenCodeConfigRoot(), ROOT_AGENTS_FILE);
    const configPath = path.join(this.getOpenCodeConfigRoot(), OPENCODE_CONFIG_FILE);
    const projectRoot = projectId ? this.projects.getProjectRootPath(projectId) : null;

    return {
      globalRule: { exists: fs.existsSync(globalRulePath), absolutePath: globalRulePath },
      projectRule: projectRoot
        ? {
            exists: fs.existsSync(path.join(projectRoot, ROOT_AGENTS_FILE)),
            absolutePath: path.join(projectRoot, ROOT_AGENTS_FILE)
          }
        : null,
      config: { exists: fs.existsSync(configPath), absolutePath: configPath },
      agents: this.listFiles(path.join(this.getOpenCodeConfigRoot(), AGENTS_DIR)),
      commands: projectRoot
        ? this.listFiles(path.join(projectRoot, PROJECT_OPENCODE_DIR, PROJECT_COMMANDS_DIR))
        : [],
      skills: this.listFiles(path.join(this.getOpenCodeConfigRoot(), SKILLS_DIR)),
      plugins: this.listFiles(path.join(this.getOpenCodeConfigRoot(), PLUGINS_DIR))
    };
  }

  public listCustomAgentNames(): string[] {
    /* Derive custom agent names from markdown filenames in agents directory. */
    return this.listFiles(this.getAgentsDir())
      .map((item) => item.name)
      .filter((name) => name.toLowerCase().endsWith(".md"))
      .map((name) => name.replace(/\.md$/i, ""))
      .filter((name) => name.length > 0)
      .sort((left, right) => left.localeCompare(right));
  }

  public readFile(kind: OpenCodeSettingsKind, projectId: string | null, relativePath?: string) {
    /* Return file content together with resolved absolute path for UI context. */
    const target = this.resolveTarget({ kind, projectId, relativePath });
    if (!fs.existsSync(target.absolutePath)) {
      return { exists: false, absolutePath: target.absolutePath, content: "" };
    }
    return {
      exists: true,
      absolutePath: target.absolutePath,
      content: fs.readFileSync(target.absolutePath, "utf-8")
    };
  }

  public saveFile(
    kind: OpenCodeSettingsKind,
    projectId: string | null,
    content: string,
    relativePath?: string
  ): { absolutePath: string } {
    /* Save text content; parent directories are created when needed. */
    const target = this.resolveTarget({ kind, projectId, relativePath });
    fs.mkdirSync(path.dirname(target.absolutePath), { recursive: true });
    fs.writeFileSync(target.absolutePath, content, "utf-8");
    return { absolutePath: target.absolutePath };
  }

  public createFile(
    kind: OpenCodeSettingsKind,
    projectId: string | null,
    name?: string
  ): { absolutePath: string } {
    /* Create empty file for requested section and return location. */
    const relativePath = this.resolveCreateName(kind, name);
    const target = this.resolveTarget({ kind, projectId, relativePath });
    fs.mkdirSync(path.dirname(target.absolutePath), { recursive: true });
    if (!fs.existsSync(target.absolutePath)) {
      fs.writeFileSync(target.absolutePath, "", "utf-8");
    }
    return { absolutePath: target.absolutePath };
  }

  private resolveCreateName(kind: OpenCodeSettingsKind, name?: string): string | undefined {
    /* Keep required names explicit for root files; list sections require user filename. */
    if (kind === "globalRule" || kind === "projectRule") {
      return ROOT_AGENTS_FILE;
    }
    if (kind === "config") {
      return OPENCODE_CONFIG_FILE;
    }
    if (!name || !name.trim()) {
      throw new Error("File name is required");
    }
    return name.trim();
  }

  private resolveTarget(input: {
    kind: OpenCodeSettingsKind;
    projectId: string | null;
    relativePath?: string;
  }): FileTarget {
    /* Resolve section + optional relative path into constrained absolute path. */
    if (input.kind === "globalRule") {
      return this.buildTarget(this.getOpenCodeConfigRoot(), ROOT_AGENTS_FILE);
    }
    if (input.kind === "projectRule") {
      const projectRoot = this.requireProjectRoot(input.projectId);
      return this.buildTarget(projectRoot, ROOT_AGENTS_FILE);
    }
    if (input.kind === "config") {
      return this.buildTarget(this.getOpenCodeConfigRoot(), OPENCODE_CONFIG_FILE);
    }
    if (input.kind === "agent") {
      return this.buildTarget(this.getAgentsDir(), this.requireRelativePath(input.relativePath));
    }
    if (input.kind === "command") {
      return this.buildTarget(
        this.getProjectCommandsDir(this.requireProjectRoot(input.projectId)),
        this.requireRelativePath(input.relativePath)
      );
    }
    if (input.kind === "skill") {
      return this.buildTarget(this.getSkillsDir(), this.requireRelativePath(input.relativePath));
    }
    return this.buildTarget(this.getPluginsDir(), this.requireRelativePath(input.relativePath));
  }

  private buildTarget(baseDir: string, relativePath: string): FileTarget {
    /* Disallow path traversal outside section roots. */
    const absolutePath = path.resolve(baseDir, relativePath);
    const normalizedBase = path.resolve(baseDir);
    if (!absolutePath.startsWith(`${normalizedBase}${path.sep}`) && absolutePath !== normalizedBase) {
      throw new Error(`Path is outside allowed root: ${relativePath}`);
    }
    return { absolutePath, baseDir: normalizedBase };
  }

  private requireRelativePath(relativePath?: string): string {
    /* Required for section lists where concrete file must be selected. */
    if (!relativePath || !relativePath.trim()) {
      throw new Error("Relative path is required");
    }
    return relativePath.trim();
  }

  private requireProjectRoot(projectId: string | null): string {
    /* Project-scoped sections depend on an active project id. */
    if (!projectId) {
      throw new Error("Project id is required for this section");
    }
    return this.projects.getProjectRootPath(projectId);
  }

  private listFiles(dir: string): SettingsFileSummary[] {
    /* List markdown/json/text files in a section directory (recursive). */
    if (!fs.existsSync(dir)) {
      return [];
    }

    const entries = this.walkDir(dir);
    return entries
      .filter((entry) => this.isEditableFile(entry.absolutePath))
      .map((entry) => ({
        name: path.basename(entry.absolutePath),
        relativePath: path.relative(dir, entry.absolutePath)
      }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  }

  private walkDir(dir: string): Array<{ absolutePath: string }> {
    /* Recursively gather files for list sections. */
    const output: Array<{ absolutePath: string }> = [];
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const name of fs.readdirSync(current)) {
        const absolutePath = path.join(current, name);
        const stat = fs.statSync(absolutePath);
        if (stat.isDirectory()) {
          stack.push(absolutePath);
          continue;
        }
        output.push({ absolutePath });
      }
    }
    return output;
  }

  private isEditableFile(filePath: string): boolean {
    /* Keep list focused on text config/source formats. */
    const ext = path.extname(filePath).toLowerCase();
    return ext === ".md" || ext === ".json" || ext === ".txt" || ext === ".yaml" || ext === ".yml";
  }

  private getOpenCodeConfigRoot(): string {
    /* Resolve global OpenCode config root from app config, fallback to container default. */
    if (this.config.opencodeConfigDir && this.config.opencodeConfigDir.trim().length > 0) {
      return path.resolve(this.config.opencodeConfigDir.trim());
    }
    return DEFAULT_CONTAINER_CONFIG_DIR;
  }

  private getAgentsDir(): string {
    return path.join(this.getOpenCodeConfigRoot(), AGENTS_DIR);
  }

  private getSkillsDir(): string {
    return path.join(this.getOpenCodeConfigRoot(), SKILLS_DIR);
  }

  private getPluginsDir(): string {
    return path.join(this.getOpenCodeConfigRoot(), PLUGINS_DIR);
  }

  private getProjectCommandsDir(projectRoot: string): string {
    return path.join(projectRoot, PROJECT_OPENCODE_DIR, PROJECT_COMMANDS_DIR);
  }
}
