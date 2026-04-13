/**
 * @fileoverview Tests for extracted admin/project Telegram commands.
 */

import { Telegraf } from "telegraf";

import { BotConfig } from "../config";
import * as activeSessionModule from "../active-session";
import { registerAdminProjectCommands } from "../bot-admin-commands";

describe("registerAdminProjectCommands", () => {
  const config: BotConfig = {
    telegramBotToken: "token",
    adminIds: [1],
    backendUrl: "http://backend:3000",
    botBackendAuthToken: "secret-token",
    publicBaseUrl: "http://localhost:4173",
    opencodePublicBaseUrl: "http://localhost:4096",
    transportMode: "auto"
  };

  const createBotMock = (): {
    bot: Telegraf;
    getCommand: (name: string) => ((ctx: any) => Promise<void>) | undefined;
  } => {
    const commands = new Map<string, (ctx: any) => Promise<void>>();
    const botLike = {
      command: jest.fn((name: string, handler: (ctx: any) => Promise<void>) => {
        commands.set(name, handler);
      })
    };

    return {
      bot: botLike as unknown as Telegraf,
      getCommand: (name: string) => commands.get(name)
    };
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("lists discovered projects for admin", async () => {
    /* /projects should render a readable project list from backend discovery output. */
    jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: true,
      json: async () => [
        { slug: "arena", runnable: true },
        { slug: "docs", runnable: false }
      ]
    } as Response);

    const mock = createBotMock();
    registerAdminProjectCommands({
      bot: mock.bot,
      config,
      isAdmin: (id: number | undefined) => id === 1,
      bindChat: jest.fn(),
      syncSlashCommands: jest.fn(async () => undefined)
    });

    const handler = mock.getCommand("projects");
    expect(handler).toBeDefined();

    const reply = jest.fn(async () => undefined);
    await handler!({ from: { id: 1 }, reply });

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("- arena"));
    expect(reply).toHaveBeenCalledWith(expect.stringContaining("- docs (no-compose)"));
  });

  it("selects project and resyncs slash commands", async () => {
    /* /project should confirm the new workspace and refresh project-scoped command aliases. */
    jest.spyOn(activeSessionModule, "fetchActiveSessionTitle").mockResolvedValue("Fix bridge");
    jest
      .spyOn(global, "fetch" as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ slug: "arena", rootPath: "/srv/projects/arena" })
      } as Response);

    const syncSlashCommands = jest.fn(async () => undefined);
    const mock = createBotMock();
    registerAdminProjectCommands({
      bot: mock.bot,
      config,
      isAdmin: (id: number | undefined) => id === 1,
      bindChat: jest.fn(),
      syncSlashCommands
    });

    const handler = mock.getCommand("project");
    expect(handler).toBeDefined();

    const reply = jest.fn(async () => undefined);
    await handler!({ from: { id: 1 }, message: { text: "/project arena" }, reply });

    expect(reply).toHaveBeenCalledWith(expect.stringContaining("📁 Выбран проект: arena"));
    expect(syncSlashCommands).toHaveBeenCalledWith(1);
  });

  it("reports backend failure when stream shutdown request is rejected", async () => {
    /* /end must not confirm success if backend refused to disable chat streaming. */
    jest.spyOn(global, "fetch" as any).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "backend down"
    } as Response);

    const mock = createBotMock();
    registerAdminProjectCommands({
      bot: mock.bot,
      config,
      isAdmin: (id: number | undefined) => id === 1,
      bindChat: jest.fn(async () => undefined),
      syncSlashCommands: jest.fn(async () => undefined)
    });

    const handler = mock.getCommand("end");
    expect(handler).toBeDefined();
    const reply = jest.fn(async () => undefined);

    await handler!({ from: { id: 1 }, chat: { id: 100 }, reply });

    expect(reply).toHaveBeenCalledWith("Ошибка backend (500)");
  });

  it("reports bindChat failure before enabling stream", async () => {
    /* /chat must stop immediately when backend chat binding fails instead of toggling stream blindly. */
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const bindChat = jest.fn(async () => {
      throw new Error("bind failed");
    });
    const fetchSpy = jest.spyOn(global, "fetch" as any).mockResolvedValue({ ok: true } as Response);
    const mock = createBotMock();

    registerAdminProjectCommands({
      bot: mock.bot,
      config,
      isAdmin: (id: number | undefined) => id === 1,
      bindChat,
      syncSlashCommands: jest.fn(async () => undefined)
    });

    const handler = mock.getCommand("chat");
    expect(handler).toBeDefined();
    const reply = jest.fn(async () => undefined);

    await handler!({ from: { id: 1 }, chat: { id: 100 }, reply });

    expect(reply).toHaveBeenCalledWith("Не удалось привязать Telegram чат к backend: bind failed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports network failure while loading projects list", async () => {
    /* /projects should surface fetch crashes instead of throwing out of the command handler. */
    jest.spyOn(global, "fetch" as any).mockRejectedValue(new Error("network down"));
    const mock = createBotMock();

    registerAdminProjectCommands({
      bot: mock.bot,
      config,
      isAdmin: (id: number | undefined) => id === 1,
      bindChat: jest.fn(async () => undefined),
      syncSlashCommands: jest.fn(async () => undefined)
    });

    const handler = mock.getCommand("projects");
    expect(handler).toBeDefined();
    const reply = jest.fn(async () => undefined);

    await handler!({ from: { id: 1 }, reply });

    expect(reply).toHaveBeenCalledWith("Ошибка backend: network down");
  });
});
