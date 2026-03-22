/**
 * @fileoverview Tests for authenticated event gateway filtering.
 */

import { WebSocket } from "ws";

import { EventsGateway } from "../events.gateway";

describe("EventsGateway", () => {
  test("rejects websocket connections with invalid tokens", () => {
    /* Unauthorized clients must be closed before they can receive any replay or live events. */
    const gateway = new EventsGateway(
      {
        subscribe: jest.fn(),
        replay: jest.fn().mockReturnValue([])
      } as any,
      {
        verifyToken: jest.fn().mockReturnValue(null)
      } as any
    );
    const client = {
      close: jest.fn(),
      send: jest.fn(),
      readyState: WebSocket.OPEN
    } as any;

    gateway.handleConnection(client, { url: "/events?token=bad" } as any);

    expect(client.close).toHaveBeenCalledWith(1008, "Unauthorized");
    expect(client.send).not.toHaveBeenCalled();
  });

  test("replays only kanban events for kanban subscribers", () => {
    /* Replay should stay limited to safe board events and ignore terminal history entirely. */
    const gateway = new EventsGateway(
      {
        subscribe: jest.fn(),
        replay: jest.fn().mockReturnValue([
          { type: "kanban.task.updated", ts: "2026-03-17T00:00:00.000Z", data: { projectSlug: "alpha" } },
          { type: "terminal.output", ts: "2026-03-17T00:00:01.000Z", data: { slug: "alpha", chunk: "pwd" } }
        ])
      } as any,
      {
        verifyToken: jest.fn().mockReturnValue({ adminId: 1, topics: ["kanban"], projectSlug: null })
      } as any
    );
    const client = {
      close: jest.fn(),
      send: jest.fn(),
      readyState: WebSocket.OPEN
    } as any;

    gateway.handleConnection(client, { url: "/events?token=ok" } as any);

    expect(client.send).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "kanban.task.updated",
        ts: "2026-03-17T00:00:00.000Z",
        data: { projectSlug: "alpha" }
      })
    );
  });

  test("broadcasts terminal chunks only to matching project subscribers", () => {
    /* Live terminal output must stay scoped to the exact project selected by the client. */
    let listener: any = null;
    const gateway = new EventsGateway(
      {
        subscribe: jest.fn((next: (event: unknown) => void) => {
          listener = next;
          return jest.fn();
        }),
        replay: jest.fn().mockReturnValue([])
      } as any,
      {
        verifyToken: jest.fn().mockReturnValue({ adminId: 1, topics: ["terminal"], projectSlug: "alpha" })
      } as any
    );
    const client = {
      close: jest.fn(),
      send: jest.fn(),
      readyState: WebSocket.OPEN
    } as any;

    gateway.onModuleInit();
    gateway.handleConnection(client, { url: "/events?token=ok" } as any);
    if (!listener) {
      throw new Error("listener was not registered");
    }

    listener({ type: "terminal.output", ts: "2026-03-17T00:00:02.000Z", data: { slug: "beta", chunk: "ls" } });
    listener({ type: "terminal.output", ts: "2026-03-17T00:00:03.000Z", data: { slug: "alpha", chunk: "pwd" } });

    expect(client.send).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "terminal.output",
        ts: "2026-03-17T00:00:03.000Z",
        data: { slug: "alpha", chunk: "pwd" }
      })
    );
  });

  test("broadcasts workspace events only to matching workspace subscribers", () => {
    /* Workspace live invalidation should respect both admin scope and optional project scope. */
    let listener: any = null;
    const gateway = new EventsGateway(
      {
        subscribe: jest.fn((next: (event: unknown) => void) => {
          listener = next;
          return jest.fn();
        }),
        replay: jest.fn().mockReturnValue([])
      } as any,
      {
        verifyToken: jest.fn().mockReturnValue({ adminId: 7, topics: ["workspace"], projectSlug: "alpha" })
      } as any
    );
    const client = {
      close: jest.fn(),
      send: jest.fn(),
      readyState: WebSocket.OPEN
    } as any;

    gateway.onModuleInit();
    gateway.handleConnection(client, { url: "/events?token=ok" } as any);
    if (!listener) {
      throw new Error("listener was not registered");
    }

    listener({
      type: "workspace.state.changed",
      ts: "2026-03-17T00:00:04.000Z",
      data: { adminId: 7, projectSlug: "beta", surfaces: ["git"], reason: "git.commit" }
    });
    listener({
      type: "workspace.state.changed",
      ts: "2026-03-17T00:00:05.000Z",
      data: { adminId: 9, projectSlug: "alpha", surfaces: ["git"], reason: "git.commit" }
    });
    listener({
      type: "workspace.state.changed",
      ts: "2026-03-17T00:00:06.000Z",
      data: { adminId: 7, projectSlug: "alpha", surfaces: ["git", "projects"], reason: "git.commit" }
    });

    expect(client.send).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "workspace.state.changed",
        ts: "2026-03-17T00:00:06.000Z",
        data: { adminId: 7, projectSlug: "alpha", surfaces: ["git", "projects"], reason: "git.commit" }
      })
    );
  });

  test("does not replay buffered workspace events on late connection", () => {
    /* Workspace replay would cause duplicate invalidations because the app already hydrates on tab entry. */
    const gateway = new EventsGateway(
      {
        subscribe: jest.fn(),
        replay: jest.fn().mockReturnValue([
          {
            type: "workspace.state.changed",
            ts: "2026-03-17T00:00:07.000Z",
            data: { adminId: 1, projectSlug: null, surfaces: ["projects"], reason: "projects.sync" }
          }
        ])
      } as any,
      {
        verifyToken: jest.fn().mockReturnValue({ adminId: 1, topics: ["workspace"], projectSlug: null })
      } as any
    );
    const client = {
      close: jest.fn(),
      send: jest.fn(),
      readyState: WebSocket.OPEN
    } as any;

    gateway.handleConnection(client, { url: "/events?token=ok" } as any);

    expect(client.send).not.toHaveBeenCalled();
  });
});
