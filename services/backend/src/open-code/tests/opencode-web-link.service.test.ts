/**
 * @fileoverview Tests for resolving browser deep-links into the current OpenCode session.
 *
 * Exports:
 * - (none)
 */

import { OpenCodeWebLinkService } from "../opencode-web-link.service";

describe("OpenCodeWebLinkService", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("returns current project/session redirect path for active admin context", async () => {
    /* Deep-link must open the exact current OpenCode project thread, not the generic home page. */
    jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify([
          { id: "f".repeat(40), worktree: "/srv/projects/arena" },
          { id: "global", worktree: "/other" }
        ]),
      json: async () => [
        { id: "f".repeat(40), worktree: "/srv/projects/arena" },
        { id: "global", worktree: "/other" }
      ]
    } as Response);

    const service = new OpenCodeWebLinkService(
      {
        opencodeServerUrl: "http://opencode:4096",
        opencodeServerUsername: "user",
        opencodeServerPassword: "pass"
      } as never,
      {
        getActiveProject: jest.fn().mockResolvedValue({ slug: "arena", rootPath: "/srv/projects/arena" })
      } as never,
      {
        getSelectedSessionID: jest.fn(() => "session-42")
      } as never
    );

    await expect(service.getCurrentSessionLink(7)).resolves.toEqual({
      projectSlug: "arena",
      sessionID: "session-42",
      redirectPath: `/project/${"f".repeat(40)}/session/session-42`
    });
  });

  it("returns null when active project has no selected session", async () => {
    /* Generic access link is the only safe option until Telegram actually has a current OpenCode thread. */
    const service = new OpenCodeWebLinkService(
      {
        opencodeServerUrl: "http://opencode:4096"
      } as never,
      {
        getActiveProject: jest.fn().mockResolvedValue({ slug: "arena", rootPath: "/srv/projects/arena" })
      } as never,
      {
        getSelectedSessionID: jest.fn(() => null)
      } as never
    );

    await expect(service.getCurrentSessionLink(7)).resolves.toBeNull();
  });
});
