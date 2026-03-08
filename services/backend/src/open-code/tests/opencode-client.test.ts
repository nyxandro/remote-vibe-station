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

  it("sends multipart prompt with local image attachment", async () => {
    /* Telegram image prompts must reach OpenCode as text+file parts in one message call. */
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
    await client.sendPromptParts(
      [
        { type: "text", text: "Что на изображении?" },
        {
          type: "file",
          mime: "image/png",
          url: "file:///tmp/telegram/shot.png",
          filename: "shot.png"
        }
      ],
      {
        directory: "/srv/projects/demo",
        model: { providerID: "opencode", modelID: "big-pickle", variant: "high" },
        agent: "plan"
      }
    );

    const requestInit = fetchMock.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(String(requestInit.body));
    expect(body.parts).toEqual([
      { type: "text", text: "Что на изображении?" },
      {
        type: "file",
        mime: "image/png",
        url: "file:///tmp/telegram/shot.png",
        filename: "shot.png"
      }
    ]);
  });

  it("fails fast for empty multipart prompt", async () => {
    /* Empty multipart payload should not create or reuse a session accidentally. */
    const fetchMock = jest.spyOn(global, "fetch" as any);
    const client = new OpenCodeClient(baseConfig);

    await expect(client.sendPromptParts([], { directory: "/srv/projects/demo" })).rejects.toThrow(
      "parts must contain at least one item"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns synthetic result when multipart request has empty response body", async () => {
    /* Image prompt fallback should keep queue flow alive when OpenCode streams answer without HTTP body. */
    jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "session-2" })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => ""
      } as Response);

    const client = new OpenCodeClient(baseConfig);
    const result = await client.sendPromptParts(
      [
        { type: "text", text: "Посмотри на картинку" },
        { type: "file", mime: "image/png", url: "file:///tmp/image.png", filename: "image.png" }
      ],
      {
        directory: "/srv/projects/demo",
        model: { providerID: "opencode", modelID: "big-pickle", variant: "high" },
        agent: "build"
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        sessionId: "session-2",
        responseText: "",
        emptyResponse: true,
        parts: [],
        info: expect.objectContaining({
          providerID: "opencode",
          modelID: "big-pickle",
          agent: "build"
        })
      })
    );
  });

  it("surfaces provider rate-limit details with retry seconds", async () => {
    /* HTTP 429 from OpenCode should include actionable retry hint for Telegram user. */
    jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ id: "session-3" })
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: {
          get: (name: string) => (name.toLowerCase() === "retry-after" ? "17" : null)
        },
        text: async () => JSON.stringify({ error: { message: "Provider rate limit exceeded" } })
      } as unknown as Response);

    const client = new OpenCodeClient(baseConfig);

    await expect(
      client.sendPrompt("hello", {
        directory: "/srv/projects/demo",
        model: { providerID: "opencode", modelID: "big-pickle" },
        agent: "build"
      })
    ).rejects.toThrow("Provider rate limit exceeded. Повтор через 17 сек.");
  });

  it("replies to a pending permission request", async () => {
    /* Permission confirmation must use session-scoped API endpoint. */
    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      text: async () => ""
    } as Response);

    const client = new OpenCodeClient(baseConfig);
    await client.replyPermission({
      directory: "/srv/projects/demo",
      sessionID: "session-1",
      permissionID: "perm-1",
      response: "once"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://opencode:4096/session/session-1/permissions/perm-1?directory=%2Fsrv%2Fprojects%2Fdemo",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ response: "once" })
      })
    );
  });

  it("creates a new session when cached session is stuck in busy state", async () => {
    /* Prevent indefinite hangs by rotating away from a blocked cached session. */
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
              providerID: "opencode",
              modelID: "big-pickle",
              mode: "primary",
              agent: "build",
              cost: 0,
              tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
            },
            parts: [{ type: "text", text: "ok-1" }]
          })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ "session-1": { type: "busy" } })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "true"
      } as Response)
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
              agent: "build",
              cost: 0,
              tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
            },
            parts: [{ type: "text", text: "ok-2" }]
          })
      } as Response);

    const client = new OpenCodeClient(baseConfig);
    await client.sendPrompt("first", {
      directory: "/srv/projects/demo",
      model: { providerID: "opencode", modelID: "big-pickle" },
      agent: "build"
    });

    const second = await client.sendPrompt("second", {
      directory: "/srv/projects/demo",
      model: { providerID: "opencode", modelID: "big-pickle" },
      agent: "build"
    });

    expect(second.sessionId).toBe("session-2");
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://opencode:4096/session/status?directory=%2Fsrv%2Fprojects%2Fdemo",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://opencode:4096/session/session-1/abort?directory=%2Fsrv%2Fprojects%2Fdemo",
      expect.objectContaining({ method: "POST" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "http://opencode:4096/session/session-2/message?directory=%2Fsrv%2Fprojects%2Fdemo",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("repairs stale busy sessions in selected directory", async () => {
    /* Manual /repair should abort busy sessions and return deterministic counters. */
    const fetchMock = jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ "ses-1": { type: "busy" }, "ses-2": { type: "idle" } })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "true"
      } as Response);

    const client = new OpenCodeClient(baseConfig);
    const result = await client.repairStuckSessions({
      directory: "/srv/projects/demo",
      busyTimeoutMs: 45_000
    });

    expect(result).toEqual({ scanned: 2, busy: 1, aborted: ["ses-1"] });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://opencode:4096/session/status?directory=%2Fsrv%2Fprojects%2Fdemo",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://opencode:4096/session/ses-1/abort?directory=%2Fsrv%2Fprojects%2Fdemo",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("aborts selected session on explicit stop request", async () => {
    /* Telegram /stop must hit OpenCode abort endpoint for the currently active session. */
    const fetchMock = jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify(true)
      } as Response);

    const client = new OpenCodeClient(baseConfig);

    const result = await client.abortSession({
      directory: "/srv/projects/demo",
      sessionID: "session-stop"
    });

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://opencode:4096/session/session-stop/abort?directory=%2Fsrv%2Fprojects%2Fdemo",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("lists sessions with title and status merged from OpenCode endpoints", async () => {
    /* Session picker needs human-readable title plus runtime status per item. */
    const fetchMock = jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify([
            { id: "session-1", title: "Fix bridge", updatedAt: "2026-02-24T11:22:33.000Z" },
            { id: "session-2" }
          ])
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            "session-1": { type: "busy", updatedAt: "2026-02-24T11:23:01.000Z" },
            "session-2": { type: "idle" }
          })
      } as Response);

    const client = new OpenCodeClient(baseConfig);
    const sessions = await client.listSessions({ directory: "/srv/projects/demo", limit: 12 });

    expect(sessions).toEqual([
      {
        id: "session-1",
        title: "Fix bridge",
        status: "busy",
        updatedAt: "2026-02-24T11:23:01.000Z"
      },
      {
        id: "session-2",
        title: null,
        status: "idle",
        updatedAt: null
      }
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://opencode:4096/session?directory=%2Fsrv%2Fprojects%2Fdemo&limit=12",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://opencode:4096/session/status?directory=%2Fsrv%2Fprojects%2Fdemo",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("filters archived sessions when OpenCode marks them explicitly", async () => {
    /* Telegram /sessions should not show archive rows when API exposes archive state. */
    jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify([
            { id: "session-active", title: "Current thread", archived: false },
            { id: "session-archive-1", title: "Old thread", archived: true },
            { id: "session-archive-2", title: "Old thread 2", archivedAt: "2026-03-01T10:00:00.000Z" }
          ])
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            "session-active": { type: "idle", updatedAt: "2026-03-06T11:23:01.000Z" },
            "session-archive-1": { type: "idle" },
            "session-archive-2": { type: "idle" }
          })
      } as Response);

    const client = new OpenCodeClient(baseConfig);
    const sessions = await client.listSessions({ directory: "/srv/projects/demo", limit: 12 });

    expect(sessions).toEqual([
      {
        id: "session-active",
        title: "Current thread",
        status: "idle",
        updatedAt: "2026-03-06T11:23:01.000Z"
      }
    ]);
  });

  it("creates and selects explicit session for directory", async () => {
    /* /new should pin created session as active for subsequent prompt execution. */
    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ id: "session-explicit" })
    } as Response);

    const client = new OpenCodeClient(baseConfig);
    const created = await client.createSession({ directory: "/srv/projects/demo" });

    expect(created).toEqual({ id: "session-explicit" });
    expect(client.getSelectedSessionID("/srv/projects/demo")).toBe("session-explicit");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://opencode:4096/session?directory=%2Fsrv%2Fprojects%2Fdemo",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("selects existing session by id even when status map is unavailable", async () => {
    /* Session selection should rely on session list endpoint, not status-only payload. */
    const fetchMock = jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([{ id: "session-archive" }, { id: "session-latest" }])
    } as Response);

    const client = new OpenCodeClient(baseConfig);
    await client.selectSession({ directory: "/srv/projects/demo", sessionID: "session-archive" });

    expect(client.getSelectedSessionID("/srv/projects/demo")).toBe("session-archive");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://opencode:4096/session?directory=%2Fsrv%2Fprojects%2Fdemo&limit=200",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when selected session id is missing in project session list", async () => {
    /* Fail fast when stale callback references non-existing session in current directory. */
    jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([{ id: "session-1" }])
    } as Response);

    const client = new OpenCodeClient(baseConfig);
    await expect(
      client.selectSession({ directory: "/srv/projects/demo", sessionID: "session-missing" })
    ).rejects.toThrow("Session not found in current project");
  });

  it("accepts selected session id with extra spaces", async () => {
    /* Telegram callback payload may contain accidental spaces; selection should trim input id. */
    jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify([{ id: "session-1" }])
    } as Response);

    const client = new OpenCodeClient(baseConfig);
    await client.selectSession({ directory: "/srv/projects/demo", sessionID: "  session-1  " });

    expect(client.getSelectedSessionID("/srv/projects/demo")).toBe("session-1");
  });

});
