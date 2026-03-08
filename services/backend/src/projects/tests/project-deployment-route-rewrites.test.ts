/**
 * @fileoverview Regression tests for shared-VDS deploy route rewrite generation.
 *
 * Exports:
 * - none - Jest suite covering route-specific rewrite behavior.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ProjectDeploymentService } from "../project-deployment.service";

const writeFile = (targetPath: string, content: string): void => {
  /* Build real compose fixtures because deploy service resolves files from disk. */
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content, "utf-8");
};

describe("ProjectDeploymentService route rewrites", () => {
  let tmpRoot: string;
  let projectsRoot: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    /* Isolate runtime override output so the regression test never touches repository data. */
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-route-rewrite-"));
    projectsRoot = path.join(tmpRoot, "projects");
    fs.mkdirSync(projectsRoot, { recursive: true });
    process.chdir(tmpRoot);
  });

  afterEach(() => {
    /* Always restore cwd before removing the temporary workspace. */
    process.chdir(originalCwd);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("does not leak one backend legacy prefix into unrelated public paths", async () => {
    /* Carusel-style backend services expose /api plus extra paths, so non-api routes must not be rewritten under /api. */
    const projectRoot = path.join(projectsRoot, "carusel");
    writeFile(
      path.join(projectRoot, "docker-compose.yml"),
      [
        "services:",
        "  backend:",
        "    image: node:22",
        "    ports:",
        '      - "8080:3000"',
        "    labels:",
        '      - "traefik.http.routers.backend.rule=(Host(`localhost`) || Host(`example.com`)) && PathPrefix(`/api`)"',
        "  website:",
        "    image: nginx:alpine",
        "    ports:",
        '      - "8081:80"'
      ].join("\n")
    );

    const composeJson = {
      services: {
        backend: {
          ports: ["8080:3000"],
          labels: ["traefik.http.routers.backend.rule=(Host(`localhost`) || Host(`example.com`)) && PathPrefix(`/api`)"]
        },
        website: { ports: ["8081:80"] }
      }
    };

    const dockerRun = jest
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify(composeJson), stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: JSON.stringify(composeJson), stderr: "" });

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
          serviceName: "website",
          internalPort: 80,
          staticRoot: null,
          routes: [
            {
              id: "web",
              mode: "docker",
              serviceName: "website",
              internalPort: 80,
              staticRoot: null,
              subdomain: null,
              pathPrefix: null
            },
            {
              id: "api",
              mode: "docker",
              serviceName: "backend",
              internalPort: 3000,
              staticRoot: null,
              subdomain: null,
              pathPrefix: "/api"
            },
            {
              id: "generated-slides",
              mode: "docker",
              serviceName: "backend",
              internalPort: 3000,
              staticRoot: null,
              subdomain: null,
              pathPrefix: "/generated-slides"
            }
          ]
        })),
        set: jest.fn()
      } as any
    );

    await service.startDeployment("carusel");

    const overridePath = path.join(tmpRoot, "data", "runtime-overrides", "carusel.docker.override.json");
    const override = JSON.parse(fs.readFileSync(overridePath, "utf-8")) as { services: Record<string, { command?: string[] }> };
    const apiCommand = override.services["proxy-carusel-api"].command?.[2] ?? "";
    const slidesCommand = override.services["proxy-carusel-generated-slides"].command?.[2] ?? "";

    expect(apiCommand).toContain("if ($$uri !~ ^/api(?:/|$$)) {");
    expect(apiCommand).toContain("rewrite ^/(.*)$ /api/$1 break;");
    expect(slidesCommand).not.toContain("/api/$1");
    expect(slidesCommand).not.toContain("^/api(?:/|$$)");
  });
});
