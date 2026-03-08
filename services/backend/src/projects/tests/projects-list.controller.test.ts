/**
 * @fileoverview Tests for ProjectsController list enrichment with deploy routes.
 *
 * Exports:
 * - (none)
 */

import { ProjectsController } from "../projects.controller";

describe("ProjectsController list", () => {
  test("returns project cards enriched with deploy preview routes", async () => {
    /* Mini App cards need ready-to-open public URLs without one extra request per expansion. */
    const projects = {
      list: jest.fn().mockResolvedValue([
        {
          id: "arena",
          slug: "arena",
          name: "arena",
          rootPath: "/srv/projects/arena",
          hasCompose: true,
          configured: true,
          runnable: true,
          status: "running"
        }
      ])
    };
    const deployment = {
      getRuntimeSnapshot: jest.fn().mockResolvedValue({
        slug: "arena",
        mode: "docker",
        serviceName: "web",
        internalPort: 3000,
        staticRoot: null,
        availableServices: ["web", "api"],
        previewUrl: "https://arena.dev.example.com",
        routes: [
          {
            id: "web",
            mode: "docker",
            serviceName: "web",
            internalPort: 3000,
            staticRoot: null,
            subdomain: null,
            pathPrefix: null,
            previewUrl: "https://arena.dev.example.com"
          },
          {
            id: "admin",
            mode: "docker",
            serviceName: "admin",
            internalPort: 3001,
            staticRoot: null,
            subdomain: "admin",
            pathPrefix: null,
            previewUrl: "https://admin.arena.dev.example.com"
          }
        ],
        deployed: true
      })
    };

    const controller = new ProjectsController(
      projects as never,
      {} as never,
      {} as never,
      deployment as never,
      {} as never,
      {} as never
    );

    await expect(controller.list()).resolves.toEqual([
      expect.objectContaining({
        slug: "arena",
        deploy: {
          previewUrl: "https://arena.dev.example.com",
          deployed: true,
          routes: [
            expect.objectContaining({ id: "web", previewUrl: "https://arena.dev.example.com" }),
            expect.objectContaining({ id: "admin", previewUrl: "https://admin.arena.dev.example.com" })
          ]
        }
      })
    ]);
    expect(deployment.getRuntimeSnapshot).toHaveBeenCalledWith("arena");
  });

  test("keeps the list working when one deploy snapshot fails", async () => {
    /* One broken runtime snapshot must not hide the rest of the project inventory from Mini App. */
    const projects = {
      list: jest.fn().mockResolvedValue([
        {
          id: "arena",
          slug: "arena",
          name: "arena",
          rootPath: "/srv/projects/arena",
          hasCompose: true,
          configured: true,
          runnable: true,
          status: "running"
        },
        {
          id: "broken",
          slug: "broken",
          name: "broken",
          rootPath: "/srv/projects/broken",
          hasCompose: true,
          configured: true,
          runnable: true,
          status: "stopped"
        }
      ])
    };
    const deployment = {
      getRuntimeSnapshot: jest
        .fn()
        .mockResolvedValueOnce({
          slug: "arena",
          mode: "docker",
          serviceName: "web",
          internalPort: 3000,
          staticRoot: null,
          availableServices: ["web"],
          previewUrl: "https://arena.dev.example.com",
          routes: [
            {
              id: "web",
              mode: "docker",
              serviceName: "web",
              internalPort: 3000,
              staticRoot: null,
              subdomain: null,
              pathPrefix: null,
              previewUrl: "https://arena.dev.example.com"
            }
          ],
          deployed: true
        })
        .mockRejectedValueOnce(new Error("snapshot unavailable"))
    };

    const controller = new ProjectsController(
      projects as never,
      {} as never,
      {} as never,
      deployment as never,
      {} as never,
      {} as never
    );
    const warn = jest.spyOn((controller as any).logger, "warn").mockImplementation(() => undefined);

    await expect(controller.list()).resolves.toEqual([
      expect.objectContaining({
        slug: "arena",
        deploy: expect.objectContaining({ previewUrl: "https://arena.dev.example.com", deployed: true })
      }),
      expect.objectContaining({
        slug: "broken",
        rootPath: "/srv/projects/broken"
      })
    ]);
    expect(warn).toHaveBeenCalled();
  });
});
