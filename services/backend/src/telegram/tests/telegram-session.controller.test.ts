/**
 * @fileoverview Tests for TelegramSessionController session endpoints.
 *
 * Exports:
 * - (none)
 */

import { Request } from "express";

import { TelegramSessionController } from "../telegram-session.controller";

describe("TelegramSessionController", () => {
  const buildController = () => {
    /* Keep prompt methods explicit to verify session endpoint contracts. */
    const prompts = {
      startNewSession: jest.fn().mockResolvedValue({ projectSlug: "arena", sessionID: "session-new" }),
      listSessions: jest.fn().mockResolvedValue({
        projectSlug: "arena",
        directory: "/home/nyx/projects/arena",
        sessions: [
          {
            id: "session-1",
            title: "Fix bridge",
            status: "idle",
            updatedAt: "2026-02-24T11:22:33.000Z",
            active: true
          }
        ]
      }),
      selectSession: jest.fn().mockResolvedValue({ projectSlug: "arena", sessionID: "session-1" })
    };

    const sessionRouting = {
      bindSession: jest.fn().mockReturnValue("tok-1"),
      resolveSessionToken: jest.fn().mockReturnValue({
        sessionID: "session-1",
        adminId: 649624756,
        directory: "/home/nyx/projects/arena"
      }),
      consumeSessionToken: jest.fn()
    };

    const controller = new TelegramSessionController(prompts as never, sessionRouting as never);
    return { controller, prompts, sessionRouting };
  };

  test("starts new session", async () => {
    /* /session/new should return ok payload for bot confirmation message. */
    const { controller, prompts } = buildController();

    const result = await controller.startNewSession({ authAdminId: 649624756 } as unknown as Request);

    expect(prompts.startNewSession).toHaveBeenCalledWith(649624756);
    expect(result).toEqual({ ok: true, projectSlug: "arena", sessionID: "session-new" });
  });

  test("lists sessions and creates callback tokens", async () => {
    /* /sessions should map session ids to short callback tokens. */
    const { controller, prompts, sessionRouting } = buildController();

    const result = await controller.listSessions({ authAdminId: 649624756 } as unknown as Request);

    expect(prompts.listSessions).toHaveBeenCalledWith(649624756);
    expect(sessionRouting.bindSession).toHaveBeenCalledWith({
      sessionID: "session-1",
      adminId: 649624756,
      directory: "/home/nyx/projects/arena"
    });
    expect(result).toEqual({
      ok: true,
      projectSlug: "arena",
      sessions: [
        {
          sessionToken: "tok-1",
          title: "Fix bridge",
          status: "idle",
          updatedAt: "2026-02-24T11:22:33.000Z",
          active: true
        }
      ]
    });
  });

  test("selects session by callback token", async () => {
    /* /session/select must resolve token before switching active OpenCode session. */
    const { controller, prompts, sessionRouting } = buildController();

    const result = await controller.selectSession(
      { sessionToken: "tok-1" },
      { authAdminId: 649624756 } as unknown as Request
    );

    expect(sessionRouting.resolveSessionToken).toHaveBeenCalledWith("tok-1");
    expect(prompts.selectSession).toHaveBeenCalledWith({ adminId: 649624756, sessionID: "session-1" });
    expect(sessionRouting.consumeSessionToken).toHaveBeenCalledWith("tok-1");
    expect(result).toEqual({ ok: true, projectSlug: "arena", sessionID: "session-1" });
  });
});
