/**
 * @fileoverview Tests for project deployment runtime helpers.
 *
 * Constructs:
 * - docker target inference - resolves deploy service/port from compose fixtures.
 * - override builders - verify generated Traefik/runtime compose fragments.
 * - compose name normalization - keeps project keys deterministic.
 */

import {
  buildDockerOverrideConfig,
  buildMultiRouteOverrideConfig,
  buildStaticComposeConfig,
  inferServicePathPrefix,
  inferDockerRuntimeTarget,
  resolveRouteServicePathPrefix,
  toDockerRouteProxyServiceName,
  toComposeProjectName
} from "../project-deployment-runtime";

describe("project-deployment-runtime helpers", () => {
  test("infers docker service and internal port from single-service compose", () => {
    /* Default docker mode should work without manual service/port settings for simple stacks. */
    const target = inferDockerRuntimeTarget({
      compose: {
        services: {
          web: {
            ports: ["3000:8080"],
            networks: { default: {} }
          }
        }
      },
      settings: {
        mode: "docker",
        serviceName: null,
        internalPort: null,
        staticRoot: null
      }
    });

    expect(target.serviceName).toBe("web");
    expect(target.internalPort).toBe(8080);
  });

  test("parses protocol-suffixed ports and array networks", () => {
    /* Compose strings like 8080:80/tcp should still infer port 80 and preserve named networks. */
    const target = inferDockerRuntimeTarget({
      compose: {
        services: {
          web: {
            ports: ["8080:80/tcp"],
            networks: ["internal", "default"]
          }
        }
      },
      settings: {
        mode: "docker",
        serviceName: null,
        internalPort: null,
        staticRoot: null
      }
    });

    expect(target.internalPort).toBe(80);
    expect(target.existingNetworks).toEqual(["internal", "default"]);
  });

  test("requires explicit serviceName when multiple services exist", () => {
    /* Fail fast to avoid random service selection on complex compose files. */
    expect(() =>
      inferDockerRuntimeTarget({
        compose: {
          services: {
            api: { ports: ["3000:3000"] },
            worker: { ports: ["4000:4000"] }
          }
        },
        settings: {
          mode: "docker",
          serviceName: null,
          internalPort: null,
          staticRoot: null
        }
      })
    ).toThrow("Set serviceName");
  });

  test("builds docker override with Traefik labels and disabled host ports", () => {
    /* Deployment override must avoid host-port conflicts and expose one routed service. */
    const override = buildDockerOverrideConfig({
      slug: "arena",
      domain: "arena.dev.example.com",
      routePathPrefix: null,
      targetServiceName: "web",
      internalPort: 8080,
      existingNetworks: ["default", "internal"],
      allServices: ["web", "db"],
      servicePathPrefix: null
    });

    const services = (override.services ?? {}) as Record<string, any>;
    expect(services.db.ports).toEqual([]);
    expect(services.web.ports).toEqual([]);
    expect(services.web.networks ?? []).not.toContain("public");
    expect(services[toDockerRouteProxyServiceName("arena", null)].networks).toEqual(["default", "internal", "public"]);
    expect(services[toDockerRouteProxyServiceName("arena", null)].labels).toContain("traefik.enable=true");
    expect(services[toDockerRouteProxyServiceName("arena", null)].labels).toContain(
      "traefik.http.routers.arena.rule=Host(`arena.dev.example.com`)"
    );
    expect(services[toDockerRouteProxyServiceName("arena", null)].labels).toContain("traefik.http.routers.arena.tls=true");
    expect(services[toDockerRouteProxyServiceName("arena", null)].labels).toContain(
      "traefik.http.routers.arena.tls.certresolver=le"
    );
    expect(services[toDockerRouteProxyServiceName("arena", null)].labels).toContain("traefik.docker.network=public");
    expect(services[toDockerRouteProxyServiceName("arena", null)].command[2]).toContain("proxy_set_header Host $$host;");
  });

  test("builds static compose config with nginx service", () => {
    /* Static mode should publish plain html via nginx + Traefik host rule. */
    const config = buildStaticComposeConfig({
      slug: "landing",
      domain: "landing.dev.example.com",
      staticPath: "/srv/projects/landing"
    });

    const staticService = (config.services as any).static;
    expect(staticService.image).toBe("nginx:alpine");
    expect(staticService.volumes).toEqual(["/srv/projects/landing:/usr/share/nginx/html:ro"]);
    expect(staticService.labels).toContain("traefik.enable=true");
    expect(staticService.labels).toContain("traefik.http.routers.landing.rule=Host(`landing.dev.example.com`)");
    expect(staticService.labels).toContain("traefik.http.routers.landing.tls=true");
    expect(staticService.labels).toContain("traefik.http.routers.landing.tls.certresolver=le");
    expect(staticService.networks).toContain("public");
  });

  test("builds multi-route override with docker and static subdomains", () => {
    /* Shared VDS deploys need one override that can expose several subdomains without host port conflicts. */
    const override = buildMultiRouteOverrideConfig({
      slug: "arena",
      allServices: ["web", "api", "worker"],
      dockerRoutes: [
        {
          routeId: "web",
          domain: "arena.dev.example.com",
          routePathPrefix: "/dashboard",
          targetServiceName: "web",
          internalPort: 3000,
          existingNetworks: ["default"],
          servicePathPrefix: "/dashboard/"
        },
        {
          routeId: "api",
          domain: "api.arena.dev.example.com",
          routePathPrefix: null,
          targetServiceName: "api",
          internalPort: 8080,
          existingNetworks: ["default", "internal"],
          servicePathPrefix: null
        },
        {
          routeId: "admin",
          domain: "arena.dev.example.com",
          routePathPrefix: "/admin",
          targetServiceName: "worker",
          internalPort: 80,
          existingNetworks: ["default"],
          servicePathPrefix: "/admin"
        }
      ],
      staticRoutes: [
        {
          routeId: "docs",
          domain: "docs.arena.dev.example.com",
          staticPath: "/srv/projects/arena/docs"
        }
      ]
    });

    const services = (override.services ?? {}) as Record<string, any>;
    expect(services.worker.ports).toEqual([]);
    expect(services.web.networks ?? []).not.toContain("public");
    expect(services.api.networks ?? []).not.toContain("public");
    expect(services[toDockerRouteProxyServiceName("arena", "web")].labels).toContain(
      "traefik.http.routers.arena-web.rule=Host(`arena.dev.example.com`) && PathPrefix(`/dashboard`)"
    );
    expect(services[toDockerRouteProxyServiceName("arena", "web")].labels).toContain(
      "traefik.http.routers.arena-web.tls=true"
    );
    expect(services[toDockerRouteProxyServiceName("arena", "web")].labels).toContain(
      "traefik.http.routers.arena-web.tls.certresolver=le"
    );
    expect(services[toDockerRouteProxyServiceName("arena", "web")].command[2]).toContain(
      "if ($$uri !~ ^/dashboard(?:/|$$)) {"
    );
    expect(services[toDockerRouteProxyServiceName("arena", "web")].command[2]).toContain(
      "rewrite ^/(.*)$ /dashboard/$1 break;"
    );
    expect(services[toDockerRouteProxyServiceName("arena", "api")].labels).toContain(
      "traefik.http.routers.arena-api.rule=Host(`api.arena.dev.example.com`)"
    );
    expect(services[toDockerRouteProxyServiceName("arena", "api")].labels).toContain(
      "traefik.http.services.arena-api.loadbalancer.server.port=80"
    );
    expect(services[toDockerRouteProxyServiceName("arena", "admin")].command[2]).toContain(
      "rewrite ^/admin/?(.*)$ /$1 break;"
    );
    expect(services[toDockerRouteProxyServiceName("arena", "admin")].labels).toContain(
      "traefik.http.routers.arena-admin.rule=Host(`arena.dev.example.com`) && PathPrefix(`/admin`)"
    );
    expect(services[toDockerRouteProxyServiceName("arena", "web")].networks).toEqual(["default", "public"]);
    expect(services[toDockerRouteProxyServiceName("arena", "api")].networks).toEqual(["default", "internal", "public"]);
    expect(services["static-arena-docs"].labels).toContain(
      "traefik.http.routers.arena-docs.rule=Host(`docs.arena.dev.example.com`)"
    );
    expect(services["static-arena-docs"].labels).toContain("traefik.http.routers.arena-docs.tls=true");
    expect(services["static-arena-docs"].labels).toContain("traefik.http.routers.arena-docs.tls.certresolver=le");
    expect(services["static-arena-docs"].volumes).toEqual(["/srv/projects/arena/docs:/usr/share/nginx/html:ro"]);
  });

  test("normalizes compose project name from slug", () => {
    /* Compose key normalization keeps docker project names deterministic and valid. */
    expect(toComposeProjectName("Do-Invest.Ru")).toBe("do-invest-ru");
    expect(toComposeProjectName("***")).toBe("p---");
  });

  test("builds deterministic proxy service names for routed docker services", () => {
    /* Proxy sidecars must have stable names so deployment can start only required runtime services. */
    expect(toDockerRouteProxyServiceName("arena", null)).toBe("proxy-arena");
    expect(toDockerRouteProxyServiceName("arena", "api")).toBe("proxy-arena-api");
  });

  test("infers service path prefix from legacy Traefik rules", () => {
    /* Legacy path-based routers should become internal rewrites on subdomain sidecars. */
    expect(
      inferServicePathPrefix({
        labels: {
          "traefik.http.routers.dashboard.rule":
            "(Host(`localhost`) || Host(`example.com`)) && PathPrefix(`/dashboard`)"
        }
      })
    ).toBe("/dashboard");
  });

  test("applies inferred service path prefix only to matching route prefixes", () => {
    /* One backend service may expose /api plus unrelated paths, so non-matching routes must not inherit /api rewrites. */
    expect(resolveRouteServicePathPrefix({ routePathPrefix: null, inferredServicePathPrefix: "/api" })).toBe("/api");
    expect(resolveRouteServicePathPrefix({ routePathPrefix: "/api", inferredServicePathPrefix: "/api" })).toBe("/api");
    expect(resolveRouteServicePathPrefix({ routePathPrefix: "/generated-slides", inferredServicePathPrefix: "/api" })).toBeNull();
    expect(resolveRouteServicePathPrefix({ routePathPrefix: "/socket.io", inferredServicePathPrefix: "/api" })).toBeNull();
  });
});
