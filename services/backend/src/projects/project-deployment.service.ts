/**
 * @fileoverview Project deployment service for per-project domain routing via Traefik.
 *
 * Exports:
 * - ProjectDeploymentService (L40) - Start/stop deployment and manage runtime settings.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { discoverProjects, DEFAULT_COMPOSE_FILENAMES } from "./project-discovery";
import { DockerComposeService } from "./docker-compose.service";
import {
  buildDockerOverrideConfig,
  buildStaticComposeConfig,
  DockerComposeConfig,
  inferDockerRuntimeTarget,
  toComposeProjectName
} from "./project-deployment-runtime";
import { assertWithinRoot } from "./project-paths";
import { ProjectStateStore } from "./project-state.store";
import {
  ProjectRuntimeSettings,
  ProjectRuntimeSettingsPatch,
  ProjectRuntimeSnapshot
} from "./project-runtime.types";
import { ProjectRuntimeSettingsStore } from "./project-runtime-settings.store";

const RUNTIME_OVERRIDES_DIR = path.join("data", "runtime-overrides");
const DEFAULT_RUNTIME_MODE: ProjectRuntimeSettings["mode"] = "docker";
const RUNTIME_FILE_SAFE_NAME_REGEX = /^[a-z0-9_-]+\.(docker\.override|static\.compose)\.json$/;

@Injectable()
export class ProjectDeploymentService {
  public constructor(
    @Inject(ConfigToken) private readonly config: AppConfig,
    private readonly docker: DockerComposeService,
    private readonly state: ProjectStateStore,
    private readonly settingsStore: ProjectRuntimeSettingsStore
  ) {}

  public async getRuntimeSnapshot(slug: string): Promise<ProjectRuntimeSnapshot> {
    /* Return resolved runtime settings with derived URL and persisted deployment state. */
    const project = this.requireProject(slug);
    const settings = await this.getResolvedSettings(slug);
    const projectState = this.state.get(slug);
    const availableServices = await this.getAvailableServices(project.rootPath, settings.mode);
    return {
      slug,
      ...settings,
      availableServices,
      previewUrl: this.buildPreviewUrl(slug),
      deployed: projectState.status === "running"
    };
  }

  public async updateRuntimeSettings(slug: string, patch: ProjectRuntimeSettingsPatch): Promise<ProjectRuntimeSnapshot> {
    /* Persist validated settings patch to project-level runtime config store. */
    this.requireProject(slug);
    const current = await this.getResolvedSettings(slug);
    const nextMode = patch.mode ?? current.mode;
    const merged: ProjectRuntimeSettings = {
      mode: nextMode,
      serviceName:
        typeof patch.serviceName === "undefined" ? current.serviceName : this.normalizeNullableString(patch.serviceName),
      internalPort:
        typeof patch.internalPort === "undefined" ? current.internalPort : this.normalizeNullablePort(patch.internalPort),
      staticRoot:
        typeof patch.staticRoot === "undefined" ? current.staticRoot : this.normalizeNullableString(patch.staticRoot)
    };

    const next: ProjectRuntimeSettings = {
      mode: nextMode,
      serviceName: nextMode === "docker" ? merged.serviceName : null,
      internalPort: nextMode === "docker" ? merged.internalPort : null,
      staticRoot: nextMode === "static" ? merged.staticRoot : null
    };

    this.assertRuntimeSettings(next);

    await this.settingsStore.set(slug, next);
    return this.getRuntimeSnapshot(slug);
  }

  public async startDeployment(slug: string): Promise<ProjectRuntimeSnapshot> {
    /* Start deployment flow for the resolved runtime mode. */
    const project = this.requireProject(slug);
    const settings = await this.getResolvedSettings(slug);
    const composeProjectName = toComposeProjectName(slug);

    if (settings.mode === "docker") {
      const composePath = this.resolveComposePath(project.rootPath);
      const composeConfig = await this.readComposeConfig(composePath);
      const runtimeTarget = inferDockerRuntimeTarget({ compose: composeConfig, settings });
      const overrideConfig = buildDockerOverrideConfig({
        slug,
        domain: this.buildProjectDomain(slug),
        targetServiceName: runtimeTarget.serviceName,
        internalPort: runtimeTarget.internalPort,
        existingNetworks: runtimeTarget.existingNetworks,
        allServices: runtimeTarget.allServices
      });
      const overridePath = this.writeRuntimeFile(
        `${this.toRuntimeFileKey(slug)}.docker.override.json`,
        overrideConfig
      );

      await this.docker.run(
        ["-f", composePath, "-f", overridePath, "-p", composeProjectName, "up", "-d"],
        path.dirname(composePath)
      );
    } else {
      const staticPath = this.resolveStaticPath(project.rootPath, settings.staticRoot);
      const staticConfig = buildStaticComposeConfig({
        slug,
        domain: this.buildProjectDomain(slug),
        staticPath
      });
      const staticComposePath = this.writeRuntimeFile(
        `${this.toRuntimeFileKey(slug)}.static.compose.json`,
        staticConfig
      );

      await this.docker.run(["-f", staticComposePath, "-p", composeProjectName, "up", "-d"], project.rootPath);
    }

    this.state.set(slug, { status: "running", lastStartedAt: new Date().toISOString() });
    return this.getRuntimeSnapshot(slug);
  }

  public async stopDeployment(slug: string): Promise<ProjectRuntimeSnapshot> {
    /* Stop deployment containers for selected runtime mode. */
    const project = this.requireProject(slug);
    const settings = await this.getResolvedSettings(slug);
    const composeProjectName = toComposeProjectName(slug);

    if (settings.mode === "docker") {
      const composePath = this.resolveComposePath(project.rootPath);
      const overridePath = this.resolveRuntimeFilePath(`${this.toRuntimeFileKey(slug)}.docker.override.json`);
      if (fs.existsSync(overridePath)) {
        await this.docker.run(
          ["-f", composePath, "-f", overridePath, "-p", composeProjectName, "stop"],
          path.dirname(composePath)
        );
      } else {
        await this.docker.run(["-f", composePath, "-p", composeProjectName, "stop"], path.dirname(composePath));
      }
    } else {
      const staticPath = this.writeRuntimeFile(
        `${this.toRuntimeFileKey(slug)}.static.compose.json`,
        buildStaticComposeConfig({
          slug,
          domain: this.buildProjectDomain(slug),
          staticPath: this.resolveStaticPath(project.rootPath, settings.staticRoot)
        })
      );
      await this.docker.run(["-f", staticPath, "-p", composeProjectName, "stop"], project.rootPath);
    }

    this.state.set(slug, { status: "stopped" });
    return this.getRuntimeSnapshot(slug);
  }

  private async getAvailableServices(rootPath: string, mode: ProjectRuntimeSettings["mode"]): Promise<string[]> {
    /* For docker mode expose compose service names as quick presets in Mini App settings. */
    if (mode !== "docker") {
      return [];
    }

    const composePath = this.tryResolveComposePath(rootPath);
    if (!composePath) {
      return [];
    }

    try {
      const composeConfig = await this.readComposeConfig(composePath);
      return Object.keys(composeConfig.services ?? {}).sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  }

  private requireProject(slug: string): { slug: string; rootPath: string } {
    /* Resolve project from discovery to avoid hidden dependencies on registry-only flows. */
    const project = discoverProjects({ projectsRoot: this.config.projectsRoot }).find((item) => item.slug === slug);
    if (!project) {
      throw new Error(`Project folder not found: ${slug}`);
    }

    return {
      slug: project.slug,
      rootPath: project.rootPath
    };
  }

  private async getResolvedSettings(slug: string): Promise<ProjectRuntimeSettings> {
    /* Apply strict defaults: docker mode with no hidden service/port assumptions. */
    const saved = await this.settingsStore.get(slug);
    if (!saved) {
      return {
        mode: DEFAULT_RUNTIME_MODE,
        serviceName: null,
        internalPort: null,
        staticRoot: null
      };
    }
    return {
      mode: saved.mode ?? DEFAULT_RUNTIME_MODE,
      serviceName: this.normalizeNullableString(saved.serviceName),
      internalPort: this.normalizeNullablePort(saved.internalPort),
      staticRoot: this.normalizeNullableString(saved.staticRoot)
    };
  }

  private buildProjectDomain(slug: string): string {
    /* Build routed domain as <slug>.<public-domain>. */
    return `${slug}.${this.config.publicDomain}`;
  }

  private buildPreviewUrl(slug: string): string {
    /* Keep preview URL deterministic for UI copy/open actions. */
    return `https://${this.buildProjectDomain(slug)}`;
  }

  private resolveComposePath(rootPath: string): string {
    /* Resolve compose file path from supported filenames with fail-fast semantics. */
    const found = this.tryResolveComposePath(rootPath);

    if (!found) {
      throw new Error("Deploy mode 'docker' requires compose file in project root");
    }

    assertWithinRoot(this.config.projectsRoot, found);
    return found;
  }

  private tryResolveComposePath(rootPath: string): string | null {
    /* Non-throwing compose resolver used by settings snapshot helpers. */
    const found = DEFAULT_COMPOSE_FILENAMES
      .map((name) => path.join(rootPath, name))
      .find((filePath) => fs.existsSync(filePath));
    return found ?? null;
  }

  private async readComposeConfig(composePath: string): Promise<DockerComposeConfig> {
    /* Delegate parsing to docker compose to respect anchors/includes/extensions. */
    const result = await this.docker.run(
      ["-f", composePath, "config", "--format", "json"],
      path.dirname(composePath)
    );

    const raw = result.stdout.trim();
    if (!raw) {
      throw new Error("Compose config is empty");
    }

    try {
      return JSON.parse(raw) as DockerComposeConfig;
    } catch (error) {
      throw new Error(`Failed to parse docker compose config JSON: ${String(error)}; outputLength=${raw.length}`);
    }
  }

  private resolveStaticPath(rootPath: string, staticRoot: string | null): string {
    /* Resolve static root and enforce filesystem boundary under current project root. */
    const relative = this.requireStaticRoot(staticRoot);
    const resolved = path.resolve(rootPath, relative);
    assertWithinRoot(rootPath, resolved);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Static root does not exist or is not a directory: ${relative}`);
    }
    return resolved;
  }

  private writeRuntimeFile(fileName: string, payload: Record<string, unknown>): string {
    /* Persist runtime compose/override files under backend data directory. */
    const directory = path.join(process.cwd(), RUNTIME_OVERRIDES_DIR);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    const targetPath = this.resolveRuntimeFilePath(fileName);
    fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf-8");
    return targetPath;
  }

  private resolveRuntimeFilePath(fileName: string): string {
    /* Restrict runtime file names to slug-based patterns inside overrides directory. */
    if (!RUNTIME_FILE_SAFE_NAME_REGEX.test(fileName)) {
      throw new Error(`Unsafe runtime file name: ${fileName}`);
    }
    return path.join(process.cwd(), RUNTIME_OVERRIDES_DIR, fileName);
  }

  private toRuntimeFileKey(slug: string): string {
    /* Normalize slug for safe runtime override file names. */
    const normalized = slug.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    return normalized.length > 0 ? normalized : "project";
  }

  private normalizeNullableString(value: string | null | undefined): string | null {
    /* Normalize empty strings to null to keep settings schema explicit. */
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeNullablePort(value: number | null | undefined): number | null {
    /* Validate explicit internal port values and clear invalid numbers. */
    if (typeof value !== "number") {
      return null;
    }
    if (!Number.isInteger(value) || value <= 0 || value > 65535) {
      throw new Error(`Invalid internalPort: ${value}`);
    }
    return value;
  }

  private assertRuntimeSettings(settings: ProjectRuntimeSettings): void {
    /* Validate mode-specific required fields to keep deployment input explicit. */
    if (settings.mode === "static") {
      this.requireStaticRoot(settings.staticRoot);
    }
  }

  private requireStaticRoot(staticRoot: string | null): string {
    /* For static mode we require explicit relative path instead of hidden defaults. */
    if (!staticRoot || staticRoot.trim().length === 0) {
      throw new Error("Set staticRoot in project runtime settings for static deploy mode");
    }
    return staticRoot.trim();
  }
}
