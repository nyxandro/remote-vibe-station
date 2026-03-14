/**
 * @fileoverview Tests for explicit local selected-session cache updates in OpenCodeClient.
 *
 * Exports:
 * - none (Jest suite).
 */

import { OpenCodeClient } from "../opencode-client";

describe("OpenCodeClient selected session cache", () => {
  const baseConfig = {
    opencodeServerUrl: "http://opencode:4096",
    opencodeServerUsername: undefined,
    opencodeServerPassword: undefined,
    opencodeDefaultProviderId: undefined,
    opencodeDefaultModelId: undefined
  };

  test("remembers a known detached session as the selected Telegram-visible thread", () => {
    /* Kanban runner already owns the session id, so switching the local active cache should not require another API round-trip. */
    const client = new OpenCodeClient(baseConfig as never);

    client.rememberSelectedSession({
      directory: "/srv/projects/demo",
      sessionID: "  session-detached  "
    });

    expect(client.getSelectedSessionID("/srv/projects/demo")).toBe("session-detached");
  });

  test("fails fast when rememberSelectedSession receives an empty session id", () => {
    /* Empty session ids would hide the real context switch bug, so the cache update must reject them immediately. */
    const client = new OpenCodeClient(baseConfig as never);

    expect(() =>
      client.rememberSelectedSession({
        directory: "/srv/projects/demo",
        sessionID: "   "
      })
    ).toThrow(
      "APP_OPENCODE_SESSION_ID_REQUIRED: Cannot remember selected session because session id is empty. Retry after a new session is created."
    );
  });
});
