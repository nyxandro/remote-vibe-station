/**
 * @fileoverview Tests for PromptService session management methods.
 *
 * Exports:
 * - (none)
 */

import { PromptService } from "../prompt.service";

describe("PromptService session management", () => {
  const buildService = (activeProject: { slug: string; rootPath: string } | null) => {
    /* Keep collaborators explicit so we can verify routing and OpenCode calls. */
    const opencode = {
      getDefaultModel: jest.fn(),
      sendPrompt: jest.fn(),
      sendPromptParts: jest.fn(),
      executeCommand: jest.fn(),
      listCommands: jest.fn(),
      getModelContextLimit: jest.fn(),
      getModelDisplayName: jest.fn(),
      createSession: jest.fn().mockResolvedValue({ id: "session-new" }),
      abortSession: jest.fn().mockResolvedValue(true),
      listSessions: jest.fn().mockResolvedValue([
        {
          id: "session-new",
          title: "Fix bridge",
          status: "idle",
          updatedAt: "2026-02-24T11:22:33.000Z"
        }
      ]),
      selectSession: jest.fn().mockResolvedValue(undefined),
      getSelectedSessionID: jest.fn().mockReturnValue("session-new")
    };

    const projects = {
      getActiveProject: jest.fn().mockResolvedValue(activeProject)
    };

    const events = { publish: jest.fn() };
    const preferences = { getExecutionSettings: jest.fn() };
    const sessionRouting = { bind: jest.fn() };
    const opencodeEvents = {
      ensureDirectory: jest.fn(),
      waitUntilConnected: jest.fn().mockResolvedValue(undefined),
      watchPermissionOnce: jest.fn()
    };

    const service = new PromptService(
      opencode as never,
      events as never,
      projects as never,
      preferences as never,
      sessionRouting as never,
      opencodeEvents as never
    );

    return { service, opencode, sessionRouting, opencodeEvents, events };
  };

  test("creates new session and binds it to Telegram admin", async () => {
    /* /new must set active session for current project and admin route map. */
    const { service, opencode, sessionRouting, opencodeEvents } = buildService({
      slug: "arena",
      rootPath: "/home/nyx/projects/arena"
    });

    const result = await service.startNewSession(649624756);

    expect(opencodeEvents.ensureDirectory).toHaveBeenCalledWith("/home/nyx/projects/arena");
    expect(opencode.createSession).toHaveBeenCalledWith({ directory: "/home/nyx/projects/arena" });
    expect(sessionRouting.bind).toHaveBeenCalledWith("session-new", {
      adminId: 649624756,
      directory: "/home/nyx/projects/arena"
    });
    expect(result).toEqual({
      projectSlug: "arena",
      sessionID: "session-new"
    });
  });

  test("returns session list with active marker", async () => {
    /* /sessions should expose project-scoped list with active flag for bot keyboard. */
    const { service, opencode, opencodeEvents } = buildService({
      slug: "arena",
      rootPath: "/home/nyx/projects/arena"
    });

    const result = await service.listSessions(649624756);

    expect(opencodeEvents.ensureDirectory).toHaveBeenCalledWith("/home/nyx/projects/arena");
    expect(opencode.listSessions).toHaveBeenCalledWith({ directory: "/home/nyx/projects/arena", limit: 12 });
    expect(result).toEqual({
      projectSlug: "arena",
      directory: "/home/nyx/projects/arena",
      sessions: [
        {
          id: "session-new",
          title: "Fix bridge",
          status: "idle",
          updatedAt: "2026-02-24T11:22:33.000Z",
          active: true
        }
      ]
    });
  });

  test("does not return archived sessions to Telegram picker", async () => {
    /* Archived threads should be filtered before bot renders /sessions keyboard. */
    const { service, opencode } = buildService({
      slug: "arena",
      rootPath: "/home/nyx/projects/arena"
    });
    opencode.listSessions.mockResolvedValue([
      {
        id: "session-active",
        title: "Current thread",
        status: "idle",
        updatedAt: "2026-03-06T11:22:33.000Z"
      }
    ]);

    const result = await service.listSessions(649624756);

    expect(result.sessions).toEqual([
      {
        id: "session-active",
        title: "Current thread",
        status: "idle",
        updatedAt: "2026-03-06T11:22:33.000Z",
        active: false
      }
    ]);
  });

  test("switches active session for selected project", async () => {
    /* Selection should update client cache and refresh permission watcher route. */
    const { service, opencode, sessionRouting, opencodeEvents } = buildService({
      slug: "arena",
      rootPath: "/home/nyx/projects/arena"
    });

    const result = await service.selectSession({ adminId: 649624756, sessionID: "session-archive" });

    expect(opencodeEvents.ensureDirectory).toHaveBeenCalledWith("/home/nyx/projects/arena");
    expect(opencode.selectSession).toHaveBeenCalledWith({
      directory: "/home/nyx/projects/arena",
      sessionID: "session-archive"
    });
    expect(sessionRouting.bind).toHaveBeenCalledWith("session-archive", {
      adminId: 649624756,
      directory: "/home/nyx/projects/arena"
    });
    expect(opencodeEvents.watchPermissionOnce).toHaveBeenCalledWith({
      directory: "/home/nyx/projects/arena",
      sessionID: "session-archive"
    });
    expect(result).toEqual({ projectSlug: "arena", sessionID: "session-archive" });
  });

  test("aborts the currently selected session for /stop", async () => {
    /* /stop should target the active project session without rotating chat context. */
    const { service, opencode, opencodeEvents, events } = buildService({
      slug: "arena",
      rootPath: "/home/nyx/projects/arena"
    });

    const result = await service.stopActiveSession(649624756);

    expect(opencodeEvents.ensureDirectory).toHaveBeenCalledWith("/home/nyx/projects/arena");
    expect(opencode.abortSession).toHaveBeenCalledWith({
      directory: "/home/nyx/projects/arena",
      sessionID: "session-new"
    });
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "opencode.session.stopped",
        data: expect.objectContaining({
          adminId: 649624756,
          projectSlug: "arena",
          directory: "/home/nyx/projects/arena",
          sessionId: "session-new",
          aborted: true
        })
      })
    );
    expect(result).toEqual({
      projectSlug: "arena",
      sessionID: "session-new",
      aborted: true
    });
  });

  test("fails fast for /stop when no active session is selected", async () => {
    /* Stop command must be explicit when there is nothing to abort in the current project. */
    const { service, opencode } = buildService({
      slug: "arena",
      rootPath: "/home/nyx/projects/arena"
    });
    opencode.getSelectedSessionID.mockReturnValue(null);

    await expect(service.stopActiveSession(649624756)).rejects.toThrow("Активная сессия не найдена");
  });

  test("fails fast for session methods when project is not selected", async () => {
    /* Session lifecycle commands are project-bound and must not run in global context. */
    const { service } = buildService(null);

    await expect(service.startNewSession(649624756)).rejects.toThrow("Проект не выбран");
    await expect(service.listSessions(649624756)).rejects.toThrow("Проект не выбран");
    await expect(service.selectSession({ adminId: 649624756, sessionID: "session-1" })).rejects.toThrow(
      "Проект не выбран"
    );
    await expect(service.stopActiveSession(649624756)).rejects.toThrow("Проект не выбран");
  });
});
