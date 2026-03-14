/**
 * @fileoverview Tests for standalone kanban board URL generation.
 *
 * Exports:
 * - none (Jest suite).
 */

import { buildKanbanBoardUrl, resolveKanbanBoardBaseUrl } from "../kanban-board-link";

describe("kanban-board-link", () => {
  test("builds standalone kanban link from configured public base URL", () => {
    /* Production share links should still point to the canonical public domain and preserve project filters. */
    expect(
      buildKanbanBoardUrl({
        token: "signed-token",
        publicBaseUrl: "https://example.test",
        projectSlug: "alpha"
      })
    ).toBe("https://example.test/miniapp/?view=kanban&project=alpha#token=signed-token");
  });

  test("prefers localhost dev origin when local browser debugging is active", () => {
    /* Local dev should keep the user inside localhost even if PUBLIC_BASE_URL points to a remote or placeholder domain. */
    expect(
      buildKanbanBoardUrl({
        token: "signed-token",
        publicBaseUrl: "https://<domain.tld>",
        localDevOrigin: "http://127.0.0.1:4173",
        projectSlug: "alpha"
      })
    ).toBe("http://127.0.0.1:4173/miniapp/?view=kanban&project=alpha#token=signed-token");
  });

  test("fails fast with a diagnosable error when no valid board base URL exists", () => {
    /* Broken config must surface a clear remediation path instead of a raw Invalid URL stack trace. */
    expect(() => resolveKanbanBoardBaseUrl({ publicBaseUrl: "https://<domain.tld>" })).toThrow(
      "APP_KANBAN_BOARD_BASE_URL_INVALID: Cannot create shared board link because board base URL is invalid. Fix PUBLIC_BASE_URL or reopen Mini App through a valid localhost URL."
    );
  });
});
