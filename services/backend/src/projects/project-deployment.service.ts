/**
 * @fileoverview Project deployment service for per-project domain routing via Traefik.
 *
 * Exports:
 * - ProjectDeploymentService - starts/stops deployments and manages runtime settings.
 *
 * Key constructs:
 * - compose resolution helpers - find direct, configured, or include-based compose files.
 * - runtime snapshot/settings helpers - normalize persisted deploy state.
 * - docker/static deploy flows - generate runtime overrides for shared-VDS routing.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { discoverProjects, DEFAULT_COMPOSE_FILENAMES } from "./project-discovery";
import { DockerComposeService } from "./docker-compose.service";
import {
  buildDockerOverrideConfig,
  buildMultiRouteOverrideConfig,
  buildStaticComposeConfig,
  DockerComposeConfig,
  inferDockerRuntimeTarget,
  inferServicePathPrefix,
  toDockerRouteProxyServiceName,
  toComposeProjectName
} from "./project-deployment-runtime";
import { assertWithinRoot } from "./project-paths";
import { buildSuggestedRuntimeRoutes } from "./project-runtime-autoconfig";
import {
  assertRuntimeRoutes,
  buildPreviewUrl,
  buildProjectDomain,
  buildSettingsFromRoutes,
  normalizeRuntimeRoutes,
  toEffectiveRoutes,
  toRouteSnapshots
} from "./project-runtime-routes";
import { ProjectStateStore } from "./project-state.store";
import {
  ProjectRuntimeRoute,
  ProjectRuntimeSettings,
  ProjectRuntimeSettingsPatch,
  ProjectRuntimeSnapshot
} from "./project-runtime.types";
import { ProjectRuntimeSettingsStore } from "./project-runtime-settings.store";

const RUNTIME_OVERRIDES_DIR = path.join("data", "runtime-overrides");
const DEFAULT_RUNTIME_MODE: ProjectRuntimeSettings["mode"] = "docker";
const RUNTIME_FILE_SAFE_NAME_REGEX = /^[a-z0-9_-]+\.(docker\.override|static\.compose)\.json$/;
const PROJECT_CONFIG_FILE_NAME = "opencode.project.json";
const INCLUDE_LINE_REGEX = /^\s*-\s*(.+?)\s*$/;

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
    const availableServices = await this.getAvailableServices(project.rootPath, settings);
    const routes = toRouteSnapshots(slug, this.config.publicDomain, settings);
    return {
      slug,
      ...settings,
      availableServices,
      previewUrl: buildPreviewUrl(slug, this.config.publicDomain, routes),
      routes,
      deployed: projectState.status === "running"
    };
  }

  public async updateRuntimeSettings(slug: string, patch: ProjectRuntimeSettingsPatch): Promise<ProjectRuntimeSnapshot> {
    /* Persist validated settings patch to project-level runtime config store. */
    this.requireProject(slug);
    const current = await this.getResolvedSettings(slug);
    const nextMode = patch.mode ?? current.mode;
    const routes = normalizeRuntimeRoutes(typeof patch.routes === "undefined" ? current.routes ?? [] : patch.routes);
    const next =
      routes.length > 0
        ? buildSettingsFromRoutes({ routes, fallbackMode: nextMode })
        : this.buildLegacySettingsFromPatch({ current, patch, nextMode });

    this.assertRuntimeSettings(next);

    await this.settingsStore.set(slug, next);
    return this.getRuntimeSnapshot(slug);
  }

  public async autoConfigureDeployment(slug: string): Promise<ProjectRuntimeSnapshot> {
    /* Agent-first flow infers common web/api/admin routes from compose without manual per-project rewrites. */
    const project = this.requireProject(slug);
    const composePath = this.resolveComposePath(project.rootPath);
    const composeConfig = await this.readComposeConfig(composePath);
    const routes = buildSuggestedRuntimeRoutes(composeConfig);

    if (routes.length === 0) {
      throw new Error("Could not infer public routes from compose services. Configure deploy settings manually.");
    }

    const settings = buildSettingsFromRoutes({ routes, fallbackMode: DEFAULT_RUNTIME_MODE });
    this.assertRuntimeSettings(settings);
    await this.settingsStore.set(slug, settings);
    return this.getRuntimeSnapshot(slug);
  }

  public async startDeployment(slug: string): Promise<ProjectRuntimeSnapshot> {
    /* Start deployment flow for the resolved runtime mode. */
    const project = this.requireProject(slug);
    const settings = await this.getResolvedSettings(slug);
    const composeProjectName = toComposeProjectName(slug);
    const explicitRoutes = settings.routes ?? [];

    if (explicitRoutes.length > 0) {
      await this.startMultiRouteDeployment({ slug, rootPath: project.rootPath, composeProjectName, routes: explicitRoutes });
    } else if (settings.mode === "docker") {
      const composePath = this.resolveComposePath(project.rootPath);
      const composeConfig = await this.readComposeConfig(composePath);
      const runtimeTarget = inferDockerRuntimeTarget({ compose: composeConfig, settings });
      const overrideConfig = buildDockerOverrideConfig({
        slug,
        domain: buildProjectDomain(slug, this.config.publicDomain, null),
        routePathPrefix: null,
        targetServiceName: runtimeTarget.serviceName,
        internalPort: runtimeTarget.internalPort,
        existingNetworks: runtimeTarget.existingNetworks,
        allServices: runtimeTarget.allServices,
        servicePathPrefix: inferServicePathPrefix(composeConfig.services?.[runtimeTarget.serviceName] ?? {})
      });
      const overridePath = this.writeRuntimeFile(
        `${this.toRuntimeFileKey(slug)}.docker.override.json`,
        overrideConfig
      );

      await this.docker.run(
        [
          "-f",
          composePath,
          "-f",
          overridePath,
          "-p",
          composeProjectName,
          "up",
          "-d",
          runtimeTarget.serviceName,
          toDockerRouteProxyServiceName(slug, null)
        ],
        path.dirname(composePath)
      );
    } else {
      const staticPath = this.resolveStaticPath(project.rootPath, settings.staticRoot);
      const staticConfig = buildStaticComposeConfig({
        slug,
        domain: buildProjectDomain(slug, this.config.publicDomain, null),
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

    if ((settings.routes ?? []).length > 0 || settings.mode === "docker") {
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
          domain: buildProjectDomain(slug, this.config.publicDomain, null),
          staticPath: this.resolveStaticPath(project.rootPath, settings.staticRoot)
        })
      );
      await this.docker.run(["-f", staticPath, "-p", composeProjectName, "stop"], project.rootPath);
    }

    this.state.set(slug, { status: "stopped" });
    return this.getRuntimeSnapshot(slug);
  }

  private async getAvailableServices(rootPath: string, settings: ProjectRuntimeSettings): Promise<string[]> {
    /* For docker mode expose compose service names as quick presets in Mini App settings. */
    const hasDockerRoutes = (settings.routes ?? []).some((route) => route.mode === "docker");
    if (settings.mode !== "docker" && !hasDockerRoutes) {
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
        staticRoot: null,
        routes: []
      };
    }
    return {
      mode: saved.mode ?? DEFAULT_RUNTIME_MODE,
      serviceName: this.normalizeNullableString(saved.serviceName),
      internalPort: this.normalizeNullablePort(saved.internalPort),
      staticRoot: this.normalizeNullableString(saved.staticRoot),
      routes: normalizeRuntimeRoutes(saved.routes ?? [])
    };
  }

  private resolveComposePath(rootPath: string): string {
    /* Resolve compose file path from project config first, then supported root filenames. */
    const found = this.tryResolveComposePath(rootPath);

    if (!found) {
      throw new Error("Deploy mode 'docker' requires compose file in project root");
    }

    assertWithinRoot(this.config.projectsRoot, found);
    return found;
  }

  private tryResolveComposePath(rootPath: string): string | null {
    /* Non-throwing compose resolver used by settings snapshot helpers. */
    const configured = this.tryResolveConfiguredComposePath(rootPath);
    if (configured) {
      return configured;
    }

    const included = this.tryResolveIncludedComposePath(rootPath);
    if (included) {
      return included;
    }

    const found = DEFAULT_COMPOSE_FILENAMES
      .map((name) => path.join(rootPath, name))
      .find((filePath) => fs.existsSync(filePath));
    return found ?? null;
  }

  private tryResolveConfiguredComposePath(rootPath: string): string | null {
    /* Prefer explicit composePath from opencode.project.json for include-bridge projects. */
    const configPath = path.join(rootPath, PROJECT_CONFIG_FILE_NAME);
    if (!fs.existsSync(configPath)) {
      return null;
    }

    let parsed: { composePath?: unknown };
    try {
      parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as { composePath?: unknown };
    } catch {
      return null;
    }

    if (typeof parsed.composePath !== "string") {
      return null;
    }

    const candidate = parsed.composePath.trim();
    if (!candidate) {
      return null;
    }

    assertWithinRoot(this.config.projectsRoot, candidate);
    if (!fs.existsSync(candidate)) {
      throw new Error(`Configured composePath does not exist: ${candidate}`);
    }

    return candidate;
  }

  private tryResolveIncludedComposePath(rootPath: string): string | null {
    /* Root bridge compose files may include the real nested compose that should be used for shared-VDS deploy. */
    const rootComposePath = DEFAULT_COMPOSE_FILENAMES
      .map((name) => path.join(rootPath, name))
      .find((filePath) => fs.existsSync(filePath));
    if (!rootComposePath) {
      return null;
    }

    const raw = fs.readFileSync(rootComposePath, "utf-8");
    const lines = raw.split(/\r?\n/);
    const includeIndex = lines.findIndex((line) => line.trim() === "include:");
    if (includeIndex === -1) {
      return null;
    }

    for (const line of lines.slice(includeIndex + 1)) {
      if (!line.startsWith(" ") && !line.startsWith("\t") && line.trim().length > 0) {
        break;
      }

      const match = line.match(INCLUDE_LINE_REGEX);
      if (!match) {
        continue;
      }

      const includeValue = match[1].trim().replace(/^['"]|['"]$/g, "");
      if (!includeValue) {
        continue;
      }

      const candidate = path.resolve(rootPath, includeValue);
      if (!fs.existsSync(candidate)) {
        continue;
      }

      assertWithinRoot(this.config.projectsRoot, candidate);
      return candidate;
    }

    return null;
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
    if ((settings.routes ?? []).length > 0) {
      assertRuntimeRoutes(settings.routes ?? []);
      return;
    }

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

  private buildLegacySettingsFromPatch(input: {
    current: ProjectRuntimeSettings;
    patch: ProjectRuntimeSettingsPatch;
    nextMode: ProjectRuntimeSettings["mode"];
  }): ProjectRuntimeSettings {
    /* Preserve existing single-route behavior when advanced routes are not configured. */
    const merged: ProjectRuntimeSettings = {
      mode: input.nextMode,
      serviceName:
        typeof input.patch.serviceName === "undefined"
          ? input.current.serviceName
          : this.normalizeNullableString(input.patch.serviceName),
      internalPort:
        typeof input.patch.internalPort === "undefined"
          ? input.current.internalPort
          : this.normalizeNullablePort(input.patch.internalPort),
      staticRoot:
        typeof input.patch.staticRoot === "undefined"
          ? input.current.staticRoot
          : this.normalizeNullableString(input.patch.staticRoot),
      routes: []
    };

    return {
      mode: input.nextMode,
      serviceName: input.nextMode === "docker" ? merged.serviceName : null,
      internalPort: input.nextMode === "docker" ? merged.internalPort : null,
      staticRoot: input.nextMode === "static" ? merged.staticRoot : null,
      routes: []
    };
  }

  private async startMultiRouteDeployment(input: {
    slug: string;
    rootPath: string;
    composeProjectName: string;
    routes: ProjectRuntimeRoute[];
  }): Promise<void> {
    /* One generated override should expose all configured subdomains for the selected project. */
    const dockerRouteInputs = input.routes.filter((route) => route.mode === "docker");
    const staticRoutes = input.routes
      .filter((route) => route.mode === "static")
      .map((route) => ({
        routeId: route.id,
        domain: buildProjectDomain(input.slug, this.config.publicDomain, route.subdomain),
        staticPath: this.resolveStaticPath(input.rootPath, route.staticRoot)
      }));

    if (dockerRouteInputs.length === 0) {
      const staticOverridePath = this.writeRuntimeFile(
        `${this.toRuntimeFileKey(input.slug)}.docker.override.json`,
        buildMultiRouteOverrideConfig({
          slug: input.slug,
          allServices: [],
          dockerRoutes: [],
          staticRoutes
        })
      );
      await this.docker.run(["-f", staticOverridePath, "-p", input.composeProjectName, "up", "-d"], input.rootPath);
      return;
    }

    const composePath = this.resolveComposePath(input.rootPath);
    const composeConfig = await this.readComposeConfig(composePath);
    const dockerRoutes = dockerRouteInputs.map((route) => {
      const runtimeTarget = inferDockerRuntimeTarget({
        compose: composeConfig,
        settings: {
          mode: "docker",
          serviceName: route.serviceName,
          internalPort: route.internalPort,
          staticRoot: null,
          routes: []
        }
      });
      return {
        routeId: route.id,
        domain: buildProjectDomain(input.slug, this.config.publicDomain, route.subdomain),
        routePathPrefix: route.pathPrefix,
        targetServiceName: runtimeTarget.serviceName,
        internalPort: runtimeTarget.internalPort,
        existingNetworks: runtimeTarget.existingNetworks,
        servicePathPrefix: inferServicePathPrefix(composeConfig.services?.[runtimeTarget.serviceName] ?? {})
      };
    });

    const overrideConfig = buildMultiRouteOverrideConfig({
      slug: input.slug,
      allServices: Object.keys(composeConfig.services ?? {}).sort((left, right) => left.localeCompare(right)),
      dockerRoutes,
      staticRoutes
    });
    const overridePath = this.writeRuntimeFile(`${this.toRuntimeFileKey(input.slug)}.docker.override.json`, overrideConfig);
    const targetServices = Array.from(new Set(dockerRoutes.map((route) => route.targetServiceName)));
    const proxyServices = dockerRoutes.map((route) => toDockerRouteProxyServiceName(input.slug, route.routeId));

    await this.docker.run(
      [
        "-f",
        composePath,
        "-f",
        overridePath,
        "-p",
        input.composeProjectName,
        "up",
        "-d",
        ...targetServices,
        ...proxyServices
      ],
      path.dirname(composePath)
    );
  }
}
