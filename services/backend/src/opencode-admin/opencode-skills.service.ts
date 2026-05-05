/**
 * @fileoverview OpenCode skills catalog and installation service.
 *
 * Exports:
 * - NeuralDeepSkillCatalogItem - Normalized remote catalog item with local install status.
 * - SkillInstallInput - Required metadata for one-click installation.
 * - OpenCodeSkillsService - Searches NeuralDeep and manages global OpenCode skill files.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";

type NeuralDeepRawSkill = {
  id?: unknown;
  name?: unknown;
  owner?: unknown;
  repo?: unknown;
  description?: unknown;
  installs?: unknown;
  trending24h?: unknown;
  category?: unknown;
  tags?: unknown;
  featured?: unknown;
  githubStars?: unknown;
  type?: unknown;
};

type NeuralDeepReadmeResponse = {
  content?: unknown;
  path?: unknown;
};

export type SkillCatalogFilter = "all" | "installed" | "available";

export type NeuralDeepSkillCatalogItem = {
  id: string;
  name: string;
  owner: string | null;
  repo: string | null;
  description: string | null;
  installs: number | null;
  trending24h: number | null;
  category: string | null;
  tags: string[];
  featured: boolean;
  githubStars: number | null;
  type: string | null;
  installed: boolean;
};

export type InstalledOpenCodeSkill = {
  name: string;
  relativePath: string;
};

export type SkillInstallInput = {
  id: string;
  name: string;
  owner?: string | null;
  repo?: string | null;
  version?: string | null;
};

const NEURALDEEP_BASE_URL = "https://neuraldeep.ru";
const SKILLS_DIR = "skills";
const SKILL_FILE_NAME = "SKILL.md";
const DEFAULT_CONTAINER_CONFIG_DIR = "/root/.config/opencode";
const SAFE_SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const CATALOG_REQUEST_TIMEOUT_MS = 8000;
const README_REQUEST_TIMEOUT_MS = 10000;
const INSTALL_TRACKING_TIMEOUT_MS = 2000;

@Injectable()
export class OpenCodeSkillsService {
  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {}

  public async searchCatalog(input: { query?: string; installed?: SkillCatalogFilter }): Promise<NeuralDeepSkillCatalogItem[]> {
    /* Query NeuralDeep directly, then enrich results with local install state from the config volume. */
    const query = input.query?.trim();
    const url = new URL("/api/skills", NEURALDEEP_BASE_URL);
    if (query) {
      url.searchParams.set("q", query);
    }

    const response = await this.fetchWithTimeout(url.toString(), CATALOG_REQUEST_TIMEOUT_MS, "APP_SKILLS_CATALOG_REQUEST_TIMEOUT");
    if (!response.ok) {
      throw new Error(`APP_SKILLS_CATALOG_REQUEST_FAILED: NeuralDeep catalog request failed with HTTP ${response.status}. Retry later or check outbound network access.`);
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      throw new Error("APP_SKILLS_CATALOG_INVALID_RESPONSE: NeuralDeep catalog returned an unexpected payload. Retry later or contact the catalog maintainer.");
    }

    const installedNames = new Set(this.listInstalledSkills().map((skill) => skill.name));
    const items = payload.map((item) => this.normalizeCatalogItem(item, installedNames));
    const filter = input.installed ?? "all";

    if (filter === "installed") {
      return items.filter((item) => item.installed);
    }
    if (filter === "available") {
      return items.filter((item) => !item.installed);
    }
    return items;
  }

  public listInstalledSkills(): InstalledOpenCodeSkill[] {
    /* OpenCode discovers global skills from ~/.config/opencode/skills/<name>/SKILL.md. */
    const skillsRoot = this.getSkillsRoot();
    if (!fs.existsSync(skillsRoot)) {
      return [];
    }

    return fs
      .readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => fs.existsSync(path.join(skillsRoot, entry.name, SKILL_FILE_NAME)))
      .map((entry) => ({ name: entry.name, relativePath: path.join(SKILLS_DIR, entry.name, SKILL_FILE_NAME) }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  public async installSkill(input: SkillInstallInput): Promise<{ installed: true; name: string; relativePath: string }> {
    /* Install only SKILL.md; bundled scripts/resources are intentionally not executed or fetched here. */
    const skillName = this.requireSafeSkillName(input.name);
    if (!input.id || input.id.trim().length === 0) {
      throw new Error("APP_SKILL_ID_REQUIRED: Skill id is required for installation. Select a skill from the catalog and retry.");
    }

    const url = new URL("/api/skills/readme", NEURALDEEP_BASE_URL);
    url.searchParams.set("skillId", input.id.trim());
    const response = await this.fetchWithTimeout(url.toString(), README_REQUEST_TIMEOUT_MS, "APP_SKILL_README_REQUEST_TIMEOUT");
    if (!response.ok) {
      throw new Error(`APP_SKILL_README_REQUEST_FAILED: NeuralDeep readme request failed with HTTP ${response.status}. Retry later or check the selected skill.`);
    }

    const payload = (await response.json()) as NeuralDeepReadmeResponse;
    if (typeof payload.content !== "string" || payload.content.trim().length === 0) {
      throw new Error("APP_SKILL_README_INVALID_RESPONSE: NeuralDeep returned an empty SKILL.md. Choose another skill or retry later.");
    }

    const targetDir = this.resolveSkillDir(skillName);
    const targetFile = path.join(targetDir, SKILL_FILE_NAME);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetFile, payload.content, "utf-8");

    await this.trackInstall(input).catch(() => undefined);
    return { installed: true, name: skillName, relativePath: path.join(SKILLS_DIR, skillName, SKILL_FILE_NAME) };
  }

  public uninstallSkill(name: string): { removed: boolean; name: string } {
    /* Remove one installed skill directory after strict name validation. */
    const skillName = this.requireSafeSkillName(name);
    const targetDir = this.resolveSkillDir(skillName);
    if (!fs.existsSync(targetDir)) {
      return { removed: false, name: skillName };
    }

    fs.rmSync(targetDir, { recursive: true, force: true });
    return { removed: true, name: skillName };
  }

  private normalizeCatalogItem(item: NeuralDeepRawSkill, installedNames: Set<string>): NeuralDeepSkillCatalogItem {
    /* Keep remote fields optional while requiring stable id/name for UI actions. */
    const id = this.requireStringField(item.id, "id");
    const name = this.requireStringField(item.name, "name");
    return {
      id,
      name,
      owner: this.optionalString(item.owner),
      repo: this.optionalString(item.repo),
      description: this.optionalString(item.description),
      installs: this.optionalNumber(item.installs),
      trending24h: this.optionalNumber(item.trending24h),
      category: this.optionalString(item.category),
      tags: Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [],
      featured: item.featured === true,
      githubStars: this.optionalNumber(item.githubStars),
      type: this.optionalString(item.type),
      installed: installedNames.has(name)
    };
  }

  private async trackInstall(input: SkillInstallInput): Promise<void> {
    /* Tracking is best-effort analytics for NeuralDeep and must not block a successful local install. */
    await this.fetchWithTimeout(`${NEURALDEEP_BASE_URL}/api/skills/install`, INSTALL_TRACKING_TIMEOUT_MS, "APP_SKILL_INSTALL_TRACKING_TIMEOUT", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: input.name, owner: input.owner, repo: input.repo, v: input.version })
    });
  }

  private async fetchWithTimeout(url: string, timeoutMs: number, timeoutCode: string, init?: RequestInit): Promise<Response> {
    /* Bound external catalog calls so upstream slowness cannot hang backend requests indefinitely. */
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`${timeoutCode}: NeuralDeep request timed out after ${timeoutMs}ms. Retry later or check outbound network access.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolveSkillDir(name: string): string {
    /* Resolve inside skills root to defend against path traversal even after name validation changes. */
    const skillsRoot = this.getSkillsRoot();
    const absolutePath = path.resolve(skillsRoot, name);
    const normalizedRoot = path.resolve(skillsRoot);
    if (!absolutePath.startsWith(`${normalizedRoot}${path.sep}`)) {
      throw new Error("APP_SKILL_PATH_OUTSIDE_ROOT: Skill path resolved outside OpenCode skills root. Check the skill name and retry.");
    }
    return absolutePath;
  }

  private requireSafeSkillName(name: string): string {
    /* OpenCode skill folder names are plain package-like names; reject paths and empty values. */
    const normalized = name.trim();
    if (!SAFE_SKILL_NAME_PATTERN.test(normalized) || normalized.includes(path.sep)) {
      throw new Error("APP_SKILL_NAME_INVALID: Skill name must be a safe folder name without path separators. Choose an installed skill and retry.");
    }
    return normalized;
  }

  private requireStringField(value: unknown, fieldName: string): string {
    /* Catalog entries without id/name cannot be safely installed from the UI. */
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`APP_SKILLS_CATALOG_FIELD_MISSING: NeuralDeep skill ${fieldName} is missing. Retry later or contact the catalog maintainer.`);
    }
    return value.trim();
  }

  private optionalString(value: unknown): string | null {
    /* Optional display metadata may be absent in catalog responses. */
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private optionalNumber(value: unknown): number | null {
    /* Numeric catalog metadata is display-only; invalid values are treated as absent. */
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  private getSkillsRoot(): string {
    /* Backend sees the same Docker volume as OpenCode through OPENCODE_CONFIG_DIR. */
    const configRoot = this.config.opencodeConfigDir?.trim()
      ? path.resolve(this.config.opencodeConfigDir.trim())
      : DEFAULT_CONTAINER_CONFIG_DIR;
    return path.join(configRoot, SKILLS_DIR);
  }
}
