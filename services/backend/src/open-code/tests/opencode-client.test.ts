/**
 * @fileoverview Tests for OpenCodeClient command APIs.
 *
 * Exports:
 * - (none)
 */

import { OpenCodeClient } from "../opencode-client";

const baseConfig = {
  telegramBotToken: "token",
  adminIds: [1],
  publicBaseUrl: "https://example.com",
  publicDomain: "example.com",
  projectsRoot: "/srv/projects",
  opencodeServerUrl: "http://opencode:4096",
  opencodeSyncOnStart: false,
  opencodeWarmRecentsOnStart: false,
  opencodeWarmRecentsLimit: 0
} as any;

describe("OpenCodeClient command APIs", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("lists available OpenCode commands", async () => {
    /* /command response must be mapped to name/description pairs. */
    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([{ name: "help", description: "Show help" }])
    } as Response);

    const client = new OpenCodeClient(baseConfig);
    const commands = await client.listCommands();

    expect(commands).toEqual([{ name: "help", description: "Show help" }]);
    expect(fetchMock).toHaveBeenCalledWith("http://opencode:4096/command", expect.any(Object));
  });

  it("executes slash command in an existing project session", async () => {
    /* First call creates session, second call runs /session/:id/command. */
    const fetchMock = jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "session-1" })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            info: {
              id: "msg-1",
              sessionID: "session-1",
              providerID: "anthropic",
              modelID: "claude",
              mode: "primary",
              agent: "build",
              cost: 0,
              tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
            },
            parts: [{ type: "text", text: "done" }]
          })
      } as Response);

    const client = new OpenCodeClient(baseConfig);
    const result = await client.executeCommand(
      { command: "help", arguments: ["x"] },
      { directory: "/srv/projects/demo" }
    );

    expect(result.responseText).toBe("done");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://opencode:4096/session/session-1/command?directory=%2Fsrv%2Fprojects%2Fdemo",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("sends prompt with selected model variant and agent", async () => {
    /* Prompt payload must include explicit model/variant/agent from UI settings. */
    const fetchMock = jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "session-2" })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            info: {
              id: "msg-2",
              sessionID: "session-2",
              providerID: "opencode",
              modelID: "big-pickle",
              mode: "primary",
              agent: "plan",
              cost: 0,
              tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
            },
            parts: [{ type: "text", text: "ok" }]
          })
      } as Response);

    const client = new OpenCodeClient(baseConfig);
    await client.sendPrompt("hello", {
      directory: "/srv/projects/demo",
      model: { providerID: "opencode", modelID: "big-pickle", variant: "high" },
      agent: "plan"
    });

    const requestInit = fetchMock.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(String(requestInit.body));
    expect(body.model).toEqual({ providerID: "opencode", modelID: "big-pickle", variant: "high" });
    expect(body.agent).toBe("plan");
  });
});
