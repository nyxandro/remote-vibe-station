/**
 * @fileoverview Tests for agent-first runtime route autoconfiguration.
 */

import { buildSuggestedRuntimeRoutes } from "../project-runtime-autoconfig";

describe("buildSuggestedRuntimeRoutes", () => {
  test("selects frontend as primary route and api as api subdomain", () => {
    /* Typical full-stack compose projects should map frontend to root and backend to api automatically. */
    const routes = buildSuggestedRuntimeRoutes({
      services: {
        frontend: { ports: ["3000:3000"] },
        api: { ports: ["8080:8080"] },
        postgres: { ports: ["5432:5432"] }
      }
    });

    expect(routes).toEqual([
      {
        id: "web",
        mode: "docker",
        serviceName: "frontend",
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
      }
    ]);
  });

  test("adds admin route when compose exposes a dashboard service", () => {
    /* Admin panels should get a stable admin subdomain without custom manual config. */
    const routes = buildSuggestedRuntimeRoutes({
      services: {
        web: { ports: ["3000:3000"] },
        admin: { ports: ["4173:4173"] }
      }
    });

    expect(routes).toEqual([
      expect.objectContaining({ serviceName: "web", subdomain: null }),
      expect.objectContaining({ id: "admin", serviceName: "admin", subdomain: "admin" })
    ]);
  });

  test("falls back to a single runnable service when no frontend alias exists", () => {
    /* Single-service projects should stay deployable without naming conventions. */
    const routes = buildSuggestedRuntimeRoutes({
      services: {
        gateway: { ports: ["4000:4000"] }
      }
    });

    expect(routes).toEqual([
      {
        id: "web",
        mode: "docker",
        serviceName: "gateway",
        internalPort: 4000,
        staticRoot: null,
        subdomain: null
      }
    ]);
  });

  test("ignores infra services without creating bogus public routes", () => {
    /* Shared dev deploy must not expose db/redis services just because they publish ports internally. */
    const routes = buildSuggestedRuntimeRoutes({
      services: {
        redis: { ports: ["6379:6379"] },
        postgres: { ports: ["5432:5432"] },
        worker: { ports: ["9000:9000"] }
      }
    });

    expect(routes).toEqual([]);
  });
});
