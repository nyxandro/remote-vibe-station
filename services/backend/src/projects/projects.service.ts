/**
 * @fileoverview Service for project registration and lifecycle control.
 *
 * Exports:
 * - SLUG_REGEX (L26) - Slug validation pattern.
 * - OVERRIDE_DIR (L27) - Directory for override files.
 * - LOG_TAIL_SIZE (L28) - Default number of log lines.
 * - ProjectsService (L31) - Register, start, stop, and inspect projects.
 * - registerProject (L43) - Validate and add a project.
 * - startProject (L64) - Start project containers.
 * - stopProject (L88) - Stop project containers.
 * - restartProject (L99) - Restart project containers.
 * - statusProject (L110) - Inspect container status.
 * - logsProject (L121) - Fetch recent logs.
 * - runContainerAction (L293) - Run lifecycle command for a single compose service.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { EventsService } from "../events/events.service";
import { assertWithinRoot } from "./project-paths";
import { ProjectCreateRequest, ProjectListItem, ProjectRecord } from "./project.types";
import { ProjectRegistry } from "./project-registry";
import { DockerComposeService } from "./docker-compose.service";
import { discoverProjects } from "./project-discovery";
import { ProjectStateStore } from "./project-state.store";
import { ActiveProjectStore } from "./active-project.store";
import { ProjectFilesService } from "./project-files.service";
import { ProjectTerminalService } from "./project-terminal.service";
import { parseDockerComposePsOutput } from "./docker-compose-ps-parser";

const SLUG_REGEX = /^[a-z0-9-]+$/;
const SERVICE_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
const COMPOSE_PROJECT_ALLOWED_REGEX = /[^a-z0-9_-]/g;
const OVERRIDE_DIR = "overrides";
const LOG_TAIL_SIZE = 200;
const PORT_SEPARATOR = "->";
const CONTAINER_ACTION_START = "start";
const CONTAINER_ACTION_STOP = "stop";
const CONTAINER_ACTION_RESTART = "restart";

type ContainerAction =
  | typeof CONTAINER_ACTION_START
  | typeof CONTAINER_ACTION_STOP
  | typeof CONTAINER_ACTION_RESTART;

type DockerComposePublisher = {
  URL?: string;
  PublishedPort?: number;
  TargetPort?: number;
};

type DockerComposePsRow = {
  Name?: string;
  Service?: string;
  State?: string;
  Status?: string;
  Publishers?: DockerComposePublisher[];
};
@Injectable()
export class ProjectsService {
  public constructor(
    @Inject(ConfigToken) private readonly config: AppConfig,
    private readonly events: EventsService,
    private readonly registry: ProjectRegistry,
    private readonly docker: DockerComposeService,
    private readonly state: ProjectStateStore,
    private readonly active: ActiveProjectStore,
    private readonly files: ProjectFilesService,
    private readonly terminals: ProjectTerminalService
  ) {}

  public async list(): Promise<ProjectListItem[]> {
    /*
     * Discover projects from the filesystem.
     * We do not require any marker files to show a folder in the UI.
     */
    const discovered = discoverProjects({ projectsRoot: this.config.projectsRoot });

    /*
     * Merge runtime state (status/lastStartedAt) stored by slug.
     * This avoids requiring a registry entry just to show a project.
     */
    return discovered.map((item) => {
      const saved = this.state.get(item.slug);
      return {
        ...item,
        status: saved.status ?? item.status,
        lastStartedAt: saved.lastStartedAt
      };
    });
  }

  public async selectProject(
    slug: string,
    options?: { emitEvent?: boolean; adminId?: number }
  ): Promise<ProjectListItem> {
    /* Persist active project selection after validating it exists. */
    const project = this.requireDiscoveredProject(slug);
    const prev = this.active.get(options?.adminId);
    this.active.set(project.slug, options?.adminId);

    /* Ensure terminal exists so the UI can attach immediately. */
    this.terminals.ensure(project.slug, project.rootPath);

    /* Emit selection event for Telegram UX (only on change). */
    const emitEvent = options?.emitEvent ?? true;
    if (emitEvent && prev !== project.slug) {
      this.events.publish({
        type: "project.selected",
        ts: new Date().toISOString(),
        data: {
          slug: project.slug,
          name: project.name,
          rootPath: project.rootPath,
          adminId: options?.adminId ?? null
        }
      });
    }
    return project;
  }

  public async getActiveProject(adminId?: number): Promise<ProjectListItem | null> {
    /* Resolve active project slug; clear stale selections automatically. */
    const slug = this.active.get(adminId);
    if (!slug) {
      return null;
    }
    try {
      return this.requireDiscoveredProject(slug);
    } catch {
      this.active.set(null, adminId);
      return null;
    }
  }

  public listFiles(slug: string, relativePath?: string) {
    /* List project files for the requested folder path. */
    const project = this.requireDiscoveredProject(slug);
    return {
      rootPath: project.rootPath,
      path: relativePath ?? "",
      entries: this.files.list(project.rootPath, relativePath)
    };
  }

  public readFile(slug: string, relativeFilePath: string) {
    /* Read a text file inside the project root. */
    const project = this.requireDiscoveredProject(slug);
    return {
      path: relativeFilePath,
      content: this.files.readText(project.rootPath, relativeFilePath)
    };
  }

  public getProjectRootPath(slug: string): string {
    /* Resolve canonical project root for services that operate outside this class. */
    const project = this.requireDiscoveredProject(slug);
    return project.rootPath;
  }

  public sendTerminalInput(slug: string, input: string): void {
    /* Send input to per-project terminal, ensuring it exists. */
    const project = this.requireDiscoveredProject(slug);
    this.terminals.ensure(project.slug, project.rootPath);
    this.terminals.sendInput(project.slug, input);
  }

  public async registerProject(input: ProjectCreateRequest): Promise<ProjectRecord> {
    /* Validate slug format. */
    if (!SLUG_REGEX.test(input.slug)) {
      throw new Error("Slug must be DNS-safe (a-z, 0-9, '-')");
    }

    /* Enforce project paths inside root. */
    assertWithinRoot(this.config.projectsRoot, input.rootPath);
    assertWithinRoot(this.config.projectsRoot, input.composePath);

    /* Ensure compose file exists. */
    if (!fs.existsSync(input.composePath)) {
      throw new Error(`Compose file not found: ${input.composePath}`);
    }

    /* Build domain for project. */
    const domain = `${input.slug}.${this.config.publicDomain}`;

    return this.registry.create(input, domain);
  }

  public async startProject(slug: string): Promise<ProjectListItem> {
    /*
     * Start a discovered project by slug.
     * We avoid a hard dependency on manual registry entries.
     */
    const discovered = this.requireDiscoveredProject(slug);
    if (!discovered.runnable) {
      throw new Error(`Project is not runnable (missing compose): ${slug}`);
    }

    const composePath = this.resolveComposePath(discovered);
    const composeProjectName = this.toComposeProjectName(slug);

    /*
     * Dev mode: start using compose only.
     * Prod mode with Traefik overrides is handled by the "registered" flow.
     */
    await this.docker.run(
      ["-f", composePath, "-p", composeProjectName, "up", "-d"],
      path.dirname(composePath)
    );

    const lastStartedAt = new Date().toISOString();
    this.state.set(slug, { status: "running", lastStartedAt });

    return {
      ...discovered,
      status: "running",
      lastStartedAt
    };
  }

  public async stopProject(slug: string): Promise<ProjectListItem> {
    /* Stop containers without removing volumes. */
    const discovered = this.requireDiscoveredProject(slug);
    if (!discovered.runnable) {
      throw new Error(`Project is not runnable (missing compose): ${slug}`);
    }

    const composePath = this.resolveComposePath(discovered);
    const composeProjectName = this.toComposeProjectName(slug);
    await this.docker.run(["-f", composePath, "-p", composeProjectName, "stop"], path.dirname(composePath));

    this.state.set(slug, { status: "stopped" });
    return { ...discovered, status: "stopped" };
  }

  public async restartProject(slug: string): Promise<ProjectListItem> {
    /* Restart all containers for the project. */
    const discovered = this.requireDiscoveredProject(slug);
    if (!discovered.runnable) {
      throw new Error(`Project is not runnable (missing compose): ${slug}`);
    }

    const composePath = this.resolveComposePath(discovered);
    const composeProjectName = this.toComposeProjectName(slug);
    await this.docker.run(
      ["-f", composePath, "-p", composeProjectName, "restart"],
      path.dirname(composePath)
    );

    const lastStartedAt = new Date().toISOString();
    this.state.set(slug, { status: "running", lastStartedAt });
    return { ...discovered, status: "running", lastStartedAt };
  }

  public async statusProject(id: string): Promise<unknown> {
    /* Inspect container status via docker compose. */
    const project = this.requireDiscoveredProject(id);
    if (!project.runnable) {
      throw new Error(`Project is not runnable (missing compose): ${id}`);
    }
    const composePath = this.resolveComposePath(project);
    const composeProjectName = this.toComposeProjectName(project.slug);
    const result = await this.docker.run(
      ["-f", composePath, "-p", composeProjectName, "ps", "--format", "json"],
      path.dirname(composePath)
    );

    /*
     * docker compose may return an empty stdout for non-running projects.
     * Treat that as an empty container list to keep the UI stable.
     */
    const raw = result.stdout.trim();
    if (!raw) {
      return [];
    }

    const parsedRows = parseDockerComposePsOutput(raw, project.slug) as DockerComposePsRow[];
    return parsedRows.map((row) => {
      /* Normalize compose schema into stable API response for Mini App. */
      const ports = (row.Publishers ?? [])
        .filter((publisher) => typeof publisher.PublishedPort === "number")
        .map((publisher) => {
          const host = publisher.URL ?? "0.0.0.0";
          const published = String(publisher.PublishedPort);
          const target = typeof publisher.TargetPort === "number" ? String(publisher.TargetPort) : "";
          return target ? `${host}:${published}${PORT_SEPARATOR}${target}` : `${host}:${published}`;
        });

      return {
        /*
         * Compose may omit `Service` depending on Docker/format version.
         * Derive it from container name `<project>-<service>-<index>` when needed.
         */
        name: row.Name ?? row.Service ?? "unknown",
        service: row.Service ?? this.deriveServiceName(row.Name, composeProjectName),
        state: row.State ?? row.Status ?? "unknown",
        ports
      };
    });
  }

  public async logsProject(id: string): Promise<string> {
    /* Fetch recent logs from docker compose. */
    const project = this.requireDiscoveredProject(id);
    if (!project.runnable) {
      throw new Error(`Project is not runnable (missing compose): ${id}`);
    }
    const composePath = this.resolveComposePath(project);
    const composeProjectName = this.toComposeProjectName(project.slug);
    const result = await this.docker.run(
      [
        "-f",
        composePath,
        "-p",
        composeProjectName,
        "logs",
        "--tail",
        String(LOG_TAIL_SIZE)
      ],
      path.dirname(composePath)
    );

    return result.stdout;
  }

  public async runContainerAction(
    slug: string,
    service: string,
    action: ContainerAction
  ): Promise<void> {
    /*
     * Execute lifecycle command for a single compose service.
     * Service-level Start uses `up -d` because `start` cannot create missing containers.
     */
    const project = this.requireDiscoveredProject(slug);
    if (!project.runnable) {
      throw new Error(`Project is not runnable (missing compose): ${slug}`);
    }
    if (!SERVICE_NAME_REGEX.test(service)) {
      throw new Error(`Invalid service name: ${service}`);
    }

    const composePath = this.resolveComposePath(project);
    const composeProjectName = this.toComposeProjectName(slug);
    const commandArgs = this.buildContainerCommandArgs({
      composePath,
      composeProjectName,
      service,
      action
    });
    await this.docker.run(commandArgs, path.dirname(composePath));
  }

  private buildContainerCommandArgs(options: {
    composePath: string;
    composeProjectName: string;
    service: string;
    action: ContainerAction;
  }): string[] {
    /* Keep argument construction centralized for predictable service commands. */
    if (options.action === CONTAINER_ACTION_START) {
      return [
        "-f",
        options.composePath,
        "-p",
        options.composeProjectName,
        "up",
        "-d",
        options.service
      ];
    }

    if (options.action === CONTAINER_ACTION_STOP) {
      return [
        "-f",
        options.composePath,
        "-p",
        options.composeProjectName,
        CONTAINER_ACTION_STOP,
        options.service
      ];
    }

    return [
      "-f",
      options.composePath,
      "-p",
      options.composeProjectName,
      CONTAINER_ACTION_RESTART,
      options.service
    ];
  }

  private requireDiscoveredProject(slug: string): ProjectListItem {
    /* Resolve project from filesystem discovery results. */
    const items = discoverProjects({ projectsRoot: this.config.projectsRoot });
    const found = items.find((item) => item.slug === slug);
    if (!found) {
      throw new Error(`Project folder not found: ${slug}`);
    }

    /* Apply persisted runtime state. */
    const saved = this.state.get(slug);
    return {
      ...found,
      status: saved.status ?? found.status,
      lastStartedAt: saved.lastStartedAt
    };
  }

  private resolveComposePath(project: ProjectListItem): string {
    /*
     * Compose path is inferred from supported filenames.
     * We keep this in one place to avoid drift.
     */
    const candidates = [
      path.join(project.rootPath, "docker-compose.yml"),
      path.join(project.rootPath, "docker-compose.yaml"),
      path.join(project.rootPath, "compose.yml"),
      path.join(project.rootPath, "compose.yaml")
    ];

    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (!found) {
      throw new Error(`Compose file not found for project: ${project.slug}`);
    }
    assertWithinRoot(this.config.projectsRoot, found);
    return found;
  }

  private deriveServiceName(containerName: string | undefined, slug: string): string {
    /*
     * Expected compose names look like `<project>-<service>-1`.
     * If the pattern does not match, return empty string and keep controls disabled.
     */
    if (!containerName || !containerName.startsWith(`${slug}-`)) {
      return "";
    }

    const suffix = containerName.slice(slug.length + 1);
    const parts = suffix.split("-");
    if (parts.length < 2) {
      return "";
    }

    parts.pop();
    const service = parts.join("-");
    return SERVICE_NAME_REGEX.test(service) ? service : "";
  }

  private toComposeProjectName(slug: string): string {
    /*
     * Docker Compose `-p` accepts only [a-z0-9_-] and must start with alnum.
     * We normalize folder slugs (e.g. `do-invest.ru`) into valid project keys.
     */
    const normalized = slug.toLowerCase().replace(COMPOSE_PROJECT_ALLOWED_REGEX, "-");
    return normalized.length > 0 ? normalized : "project";
  }

  private writeOverride(project: ProjectRecord): string {
    /* Prepare override file with Traefik labels. */
    const overridesDir = path.join(process.cwd(), "data", OVERRIDE_DIR);
    if (!fs.existsSync(overridesDir)) {
      fs.mkdirSync(overridesDir, { recursive: true });
    }

    const overridePath = path.join(overridesDir, `${project.slug}.override.yml`);
    const content = this.buildOverrideContent(project);
    fs.writeFileSync(overridePath, content, "utf-8");

    return overridePath;
  }

  private buildOverrideContent(project: ProjectRecord): string {
    /* Build YAML override for Traefik routing. */
    return [
      "services:",
      `  ${project.serviceName}:`,
      "    labels:",
      "      - \"traefik.enable=true\"",
      `      - \"traefik.http.routers.${project.slug}.rule=Host(\`${project.domain}\`)\"`,
      `      - \"traefik.http.routers.${project.slug}.entrypoints=websecure\"`,
      `      - \"traefik.http.routers.${project.slug}.tls.certresolver=le\"`,
      `      - \"traefik.http.routers.${project.slug}.middlewares=noindex-headers@file\"`,
      `      - \"traefik.http.services.${project.slug}.loadbalancer.server.port=${project.servicePort}\"`,
      "    networks:",
      "      - public",
      "",
      "networks:",
      "  public:",
      "    external: true",
      ""
    ].join("\n");
  }
}
