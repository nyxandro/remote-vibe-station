/**
 * @fileoverview Tests for ProjectDeploymentService docker/static runtime flows.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ProjectDeploymentService } from "../project-deployment.service";

const writeFile = (filePath: string, content: string): void => {
  /* Create fixture file with parent folders for deployment tests. */
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
};

describe("ProjectDeploymentService", () => {
  let tempRoot: string;
  let projectsRoot: string;
  let originalCwd: string;

  beforeEach(() => {
    /* Isolate cwd because runtime files are stored relative to process.cwd(). */
    originalCwd = process.cwd();
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-deploy-"));
    process.chdir(tempRoot);
    projectsRoot = path.join(tempRoot, "projects");
    fs.mkdirSync(projectsRoot, { recursive: true });
  });

  afterEach(() => {
    /* Restore cwd and cleanup temporary fixture tree. */
    process.chdir(originalCwd);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("starts docker deployment with generated override file", async () => {
    /* Docker mode should infer target and call compose with base+override files. */
    const projectRoot = path.join(projectsRoot, "arena");
    writeFile(
      path.join(projectRoot, "docker-compose.yml"),
      "services:\n  web:\n    image: node:22\n    ports:\n      - \"3000:8080\"\n"
    );

    const dockerRun = jest
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ services: { web: { ports: ["3000:8080"] } } }), stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify({ services: { web: { ports: ["3000:8080"] } } }), stderr: "" });

    const service = new ProjectDeploymentService(
      {
        telegramBotToken: "token",
        adminIds: [1],
        publicBaseUrl: "https://example.com",
        publicDomain: "dev.example.com",
        projectsRoot,
        opencodeSyncOnStart: false,
        opencodeWarmRecentsOnStart: false,
        opencodeWarmRecentsLimit: 0,
        opencodeServerUrl: "http://opencode:4096",
        eventBufferSize: 100
      } as any,
      { run: dockerRun } as any,
      { set: jest.fn(), get: jest.fn(() => ({ status: "stopped" })) } as any,
      { get: jest.fn(() => null), set: jest.fn() } as any
    );

    const result = await service.startDeployment("arena");

    expect(result.mode).toBe("docker");
    expect(result.availableServices).toEqual(["web"]);
    expect(result.previewUrl).toBe("https://arena.dev.example.com");
    expect(dockerRun).toHaveBeenCalledTimes(3);
    const deployCallArgs = dockerRun.mock.calls[1][0] as string[];
    expect(deployCallArgs).toContain("up");
    expect(deployCallArgs).toContain("-d");
    expect(deployCallArgs).toContain("-f");
  });

  test("starts static deployment using generated nginx compose", async () => {
    /* Static mode should serve root folder via nginx container and Traefik route. */
    const projectRoot = path.join(projectsRoot, "landing");
    fs.mkdirSync(projectRoot, { recursive: true });
    writeFile(path.join(projectRoot, "index.html"), "<h1>Hello</h1>");

    const dockerRun = jest.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const settingsStore = {
      get: jest.fn(() => ({ mode: "static", serviceName: null, internalPort: null, staticRoot: "." })),
      set: jest.fn()
    };

    const service = new ProjectDeploymentService(
      {
        telegramBotToken: "token",
        adminIds: [1],
        publicBaseUrl: "https://example.com",
        publicDomain: "dev.example.com",
        projectsRoot,
        opencodeSyncOnStart: false,
        opencodeWarmRecentsOnStart: false,
        opencodeWarmRecentsLimit: 0,
        opencodeServerUrl: "http://opencode:4096",
        eventBufferSize: 100
      } as any,
      { run: dockerRun } as any,
      { set: jest.fn(), get: jest.fn(() => ({ status: "stopped" })) } as any,
      settingsStore as any
    );

    const result = await service.startDeployment("landing");

    expect(result.mode).toBe("static");
    expect(result.availableServices).toEqual([]);
    expect(dockerRun).toHaveBeenCalledWith(
      expect.arrayContaining(["up", "-d"]),
      projectRoot
    );
  });

  test("rejects static deploy when staticRoot is not configured", async () => {
    /* Static mode requires explicit root path to avoid hidden defaults and wrong folders. */
    const projectRoot = path.join(projectsRoot, "landing");
    fs.mkdirSync(projectRoot, { recursive: true });
    writeFile(path.join(projectRoot, "index.html"), "<h1>Hello</h1>");

    const dockerRun = jest.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    const service = new ProjectDeploymentService(
      {
        telegramBotToken: "token",
        adminIds: [1],
        publicBaseUrl: "https://example.com",
        publicDomain: "dev.example.com",
        projectsRoot,
        opencodeSyncOnStart: false,
        opencodeWarmRecentsOnStart: false,
        opencodeWarmRecentsLimit: 0,
        opencodeServerUrl: "http://opencode:4096",
        eventBufferSize: 100
      } as any,
      { run: dockerRun } as any,
      { set: jest.fn(), get: jest.fn(() => ({ status: "stopped" })) } as any,
      {
        get: jest.fn(() => ({ mode: "static", serviceName: null, internalPort: null, staticRoot: null })),
        set: jest.fn()
      } as any
    );

    await expect(service.startDeployment("landing")).rejects.toThrow("Set staticRoot in project runtime settings");
    expect(dockerRun).not.toHaveBeenCalled();
  });

  test("keeps internalPort only for docker mode when settings are updated", async () => {
    /* Mode-specific settings should be normalized so stale fields do not leak across runtimes. */
    const projectRoot = path.join(projectsRoot, "arena");
    fs.mkdirSync(projectRoot, { recursive: true });

    let savedSettings: any = null;
    const settingsStore = {
      get: jest.fn(() => savedSettings),
      set: jest.fn((slug: string, value: unknown) => {
        savedSettings = value;
        return { slug, value };
      })
    };

    const service = new ProjectDeploymentService(
      {
        telegramBotToken: "token",
        adminIds: [1],
        publicBaseUrl: "https://example.com",
        publicDomain: "dev.example.com",
        projectsRoot,
        opencodeSyncOnStart: false,
        opencodeWarmRecentsOnStart: false,
        opencodeWarmRecentsLimit: 0,
        opencodeServerUrl: "http://opencode:4096",
        eventBufferSize: 100
      } as any,
      { run: jest.fn() } as any,
      { set: jest.fn(), get: jest.fn(() => ({ status: "stopped" })) } as any,
      settingsStore as any
    );

    await service.updateRuntimeSettings("arena", { mode: "docker", serviceName: "web", internalPort: 8080 });
    await service.updateRuntimeSettings("arena", { mode: "static", staticRoot: "public" });

    expect(settingsStore.set).toHaveBeenNthCalledWith(1, "arena", {
      mode: "docker",
      serviceName: "web",
      internalPort: 8080,
      staticRoot: null,
      routes: []
    });
    expect(settingsStore.set).toHaveBeenNthCalledWith(2, "arena", {
      mode: "static",
      serviceName: null,
      internalPort: null,
      staticRoot: "public",
      routes: []
    });
  });

  test("rejects static mode update when staticRoot is missing", async () => {
    /* Fail fast during settings save so user gets immediate actionable feedback. */
    const projectRoot = path.join(projectsRoot, "arena");
    fs.mkdirSync(projectRoot, { recursive: true });

    const settingsStore = {
      get: jest.fn(() => null),
      set: jest.fn()
    };

    const service = new ProjectDeploymentService(
      {
        telegramBotToken: "token",
        adminIds: [1],
        publicBaseUrl: "https://example.com",
        publicDomain: "dev.example.com",
        projectsRoot,
        opencodeSyncOnStart: false,
        opencodeWarmRecentsOnStart: false,
        opencodeWarmRecentsLimit: 0,
        opencodeServerUrl: "http://opencode:4096",
        eventBufferSize: 100
      } as any,
      { run: jest.fn() } as any,
      { set: jest.fn(), get: jest.fn(() => ({ status: "stopped" })) } as any,
      settingsStore as any
    );

    await expect(service.updateRuntimeSettings("arena", { mode: "static" })).rejects.toThrow(
      "Set staticRoot in project runtime settings"
    );
    expect(settingsStore.set).not.toHaveBeenCalled();
  });

  test("returns sorted docker services in runtime snapshot for presets", async () => {
    /* Settings payload should include compose service names for quick serviceName fill. */
    const projectRoot = path.join(projectsRoot, "arena");
    writeFile(
      path.join(projectRoot, "docker-compose.yml"),
      "services:\n  web:\n    image: node:22\n  api:\n    image: node:22\n"
    );

    const dockerRun = jest.fn().mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ services: { web: { ports: ["3000:8080"] }, api: { ports: ["4000:4000"] } } }),
      stderr: ""
    });

    const service = new ProjectDeploymentService(
      {
        telegramBotToken: "token",
        adminIds: [1],
        publicBaseUrl: "https://example.com",
        publicDomain: "dev.example.com",
        projectsRoot,
        opencodeSyncOnStart: false,
        opencodeWarmRecentsOnStart: false,
        opencodeWarmRecentsLimit: 0,
        opencodeServerUrl: "http://opencode:4096",
        eventBufferSize: 100
      } as any,
      { run: dockerRun } as any,
      { set: jest.fn(), get: jest.fn(() => ({ status: "stopped" })) } as any,
      {
        get: jest.fn(() => ({ mode: "docker", serviceName: null, internalPort: null, staticRoot: null })),
        set: jest.fn()
      } as any
    );

    const snapshot = await service.getRuntimeSnapshot("arena");
    expect(snapshot.availableServices).toEqual(["api", "web"]);
  });

  test("starts multi-route deployment with per-route subdomains", async () => {
    /* One project should expose several dev subdomains from one shared VDS override file. */
    const projectRoot = path.join(projectsRoot, "arena");
    writeFile(
      path.join(projectRoot, "docker-compose.yml"),
      [
        "services:",
        "  web:",
        "    image: node:22",
        "    ports:",
        '      - "3000:3000"',
        "  api:",
        "    image: node:22",
        "    ports:",
        '      - "8080:8080"'
      ].join("\n")
    );
    writeFile(path.join(projectRoot, "docs", "index.html"), "<h1>Docs</h1>");

    const dockerRun = jest
      .fn()
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          services: {
            web: { ports: ["3000:3000"] },
            api: { ports: ["8080:8080"] }
          }
        }),
        stderr: ""
      })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          services: {
            web: { ports: ["3000:3000"] },
            api: { ports: ["8080:8080"] }
          }
        }),
        stderr: ""
      });

    const service = new ProjectDeploymentService(
      {
        telegramBotToken: "token",
        adminIds: [1],
        publicBaseUrl: "https://example.com",
        publicDomain: "dev.example.com",
        projectsRoot,
        opencodeSyncOnStart: false,
        opencodeWarmRecentsOnStart: false,
        opencodeWarmRecentsLimit: 0,
        opencodeServerUrl: "http://opencode:4096",
        eventBufferSize: 100
      } as any,
      { run: dockerRun } as any,
      { set: jest.fn(), get: jest.fn(() => ({ status: "stopped" })) } as any,
      {
        get: jest.fn(() => ({
          mode: "docker",
          serviceName: null,
          internalPort: null,
          staticRoot: null,
          routes: [
            {
              id: "web",
              mode: "docker",
              serviceName: "web",
              internalPort: 3000,
              staticRoot: null,
              subdomain: null
            },
            {
              id: "api",
              mode: "docker",
              serviceName: "api",
              internalPort: 8080,
              staticRoot: null,
              subdomain: "api"
            },
            {
              id: "docs",
              mode: "static",
              serviceName: null,
              internalPort: null,
              staticRoot: "docs",
              subdomain: "docs"
            }
          ]
        })),
        set: jest.fn()
      } as any
    );

    const result = await service.startDeployment("arena");

    expect(result.previewUrl).toBe("https://arena.dev.example.com");
    expect(result.routes).toEqual([
      expect.objectContaining({ id: "web", previewUrl: "https://arena.dev.example.com" }),
      expect.objectContaining({ id: "api", previewUrl: "https://api.arena.dev.example.com" }),
      expect.objectContaining({ id: "docs", previewUrl: "https://docs.arena.dev.example.com" })
    ]);
    expect(dockerRun).toHaveBeenCalledTimes(3);
    const deployCallArgs = dockerRun.mock.calls[1][0] as string[];
    expect(deployCallArgs).toEqual(expect.arrayContaining(["up", "-d"]));
    expect(deployCallArgs.slice(-2)).toEqual(["web", "api"]);
  });

  test("autoconfigures deploy routes from compose services", async () => {
    /* Agent-first deploy flow should infer web/api routes without asking for manual settings first. */
    const projectRoot = path.join(projectsRoot, "arena");
    writeFile(
      path.join(projectRoot, "docker-compose.yml"),
      [
        "services:",
        "  frontend:",
        "    image: node:22",
        "    ports:",
        '      - "3000:3000"',
        "  api:",
        "    image: node:22",
        "    ports:",
        '      - "8080:8080"'
      ].join("\n")
    );

    let savedSettings: any = null;
    const settingsStore = {
      get: jest.fn(() => savedSettings),
      set: jest.fn((slug: string, value: unknown) => {
        savedSettings = value;
        return { slug, value };
      })
    };

    const dockerRun = jest
      .fn()
      .mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify({
          services: {
            frontend: { ports: ["3000:3000"] },
            api: { ports: ["8080:8080"] }
          }
        }),
        stderr: ""
      });

    const service = new ProjectDeploymentService(
      {
        telegramBotToken: "token",
        adminIds: [1],
        publicBaseUrl: "https://example.com",
        publicDomain: "dev.example.com",
        projectsRoot,
        opencodeSyncOnStart: false,
        opencodeWarmRecentsOnStart: false,
        opencodeWarmRecentsLimit: 0,
        opencodeServerUrl: "http://opencode:4096",
        eventBufferSize: 100
      } as any,
      { run: dockerRun } as any,
      { set: jest.fn(), get: jest.fn(() => ({ status: "stopped" })) } as any,
      settingsStore as any
    );

    const result = await service.autoConfigureDeployment("arena");

    expect(settingsStore.set).toHaveBeenCalledWith(
      "arena",
      expect.objectContaining({
        mode: "docker",
        serviceName: "frontend",
        internalPort: 3000,
        routes: [
          expect.objectContaining({ id: "web", serviceName: "frontend", subdomain: null }),
          expect.objectContaining({ id: "api", serviceName: "api", subdomain: "api" })
        ]
      })
    );
    expect(result.routes).toEqual([
      expect.objectContaining({ previewUrl: "https://arena.dev.example.com" }),
      expect.objectContaining({ previewUrl: "https://api.arena.dev.example.com" })
    ]);
  });

  test("uses included nested compose file for bridge-based deploys", async () => {
    /* Shared VDS should support project-local bridge compose files by targeting the real nested compose file. */
    const projectRoot = path.join(projectsRoot, "carusel");
    writeFile(path.join(projectRoot, "docker-compose.yml"), "include:\n  - infra/docker/docker-compose.yml\n");
    writeFile(
      path.join(projectRoot, "infra", "docker", "docker-compose.yml"),
      [
        "services:",
        "  dashboard:",
        "    image: node:22",
        "    ports:",
        '      - "3000:3000"',
        "  backend:",
        "    image: node:22",
        "    ports:",
        '      - "8080:3000"'
      ].join("\n")
    );

    const dockerRun = jest
      .fn()
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          services: {
            dashboard: { ports: ["3000:3000"] },
            backend: { ports: ["8080:3000"] }
          }
        }),
        stderr: ""
      })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          services: {
            dashboard: { ports: ["3000:3000"] },
            backend: { ports: ["8080:3000"] }
          }
        }),
        stderr: ""
      });

    const service = new ProjectDeploymentService(
      {
        telegramBotToken: "token",
        adminIds: [1],
        publicBaseUrl: "https://example.com",
        publicDomain: "dev.example.com",
        projectsRoot,
        opencodeSyncOnStart: false,
        opencodeWarmRecentsOnStart: false,
        opencodeWarmRecentsLimit: 0,
        opencodeServerUrl: "http://opencode:4096",
        eventBufferSize: 100
      } as any,
      { run: dockerRun } as any,
      { set: jest.fn(), get: jest.fn(() => ({ status: "stopped" })) } as any,
      {
        get: jest.fn(() => ({
          mode: "docker",
          serviceName: null,
          internalPort: null,
          staticRoot: null,
          routes: [
            {
              id: "web",
              mode: "docker",
              serviceName: "dashboard",
              internalPort: 3000,
              staticRoot: null,
              subdomain: null
            },
            {
              id: "api",
              mode: "docker",
              serviceName: "backend",
              internalPort: 3000,
              staticRoot: null,
              subdomain: "api"
            }
          ]
        })),
        set: jest.fn()
      } as any
    );

    await service.startDeployment("carusel");

    expect(dockerRun).toHaveBeenNthCalledWith(
      1,
      ["-f", path.join(projectRoot, "infra", "docker", "docker-compose.yml"), "config", "--format", "json"],
      path.join(projectRoot, "infra", "docker")
    );
    expect(dockerRun).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining(["-f", path.join(projectRoot, "infra", "docker", "docker-compose.yml"), "dashboard", "backend"]),
      path.join(projectRoot, "infra", "docker")
    );
  });
});
