/**
 * @fileoverview Tests for TelegramCommandCatalogService command aggregation.
 *
 * Exports:
 * - (none)
 */

import { TelegramCommandCatalogService } from "../telegram-command-catalog.service";

describe("TelegramCommandCatalogService", () => {
  it("merges local and OpenCode commands into Telegram menu shape", async () => {
    /* Keep OpenCode list mixed to validate normalize/filter behavior end-to-end. */
    const prompts = {
      listAvailableCommands: jest.fn().mockResolvedValue([
        { name: "help", description: "Show help" },
        { name: "deploy-changes", description: "Deploy changes" },
        { name: "bad command", description: "Invalid" }
      ])
    };
    const service = new TelegramCommandCatalogService(prompts as never);

    const catalog = await service.listForAdmin(42);

    const names = catalog.commands.map((item) => item.command);
    expect(names).toEqual(
      expect.arrayContaining([
        "start",
        "open",
        "mode",
        "chat",
        "end",
        "new",
        "sessions",
        "repair",
        "projects",
        "project"
      ])
    );
    expect(names).toEqual(expect.arrayContaining(["help", "deploy_changes"]));
    expect(names).not.toContain("bad command");
    expect(catalog.lookup.deploy_changes).toBe("deploy-changes");
    expect(catalog.lookup.help).toBe("help");
  });

  it("keeps first command when duplicate telegram names appear", async () => {
    /* Duplicate aliases should not override the first inserted command in menu. */
    const prompts = {
      listAvailableCommands: jest.fn().mockResolvedValue([
        { name: "deploy-changes", description: "First" },
        { name: "deploy_changes", description: "Second" }
      ])
    };
    const service = new TelegramCommandCatalogService(prompts as never);

    const catalog = await service.listForAdmin(42);
    const reviewItems = catalog.commands.filter((item) => item.command === "deploy_changes");

    expect(reviewItems).toHaveLength(1);
    expect(reviewItems[0]?.description).toBe("First");
  });

  it("excludes blocked OpenCode commands from Telegram menu and lookup", async () => {
    /* Telegram bridge intentionally hides OpenCode maintenance commands. */
    const prompts = {
      listAvailableCommands: jest.fn().mockResolvedValue([
        { name: "init", description: "init docs" },
        { name: "review", description: "review changes" },
        { name: "deploy", description: "deploy release" }
      ])
    };
    const service = new TelegramCommandCatalogService(prompts as never);

    const catalog = await service.listForAdmin(42);
    const names = catalog.commands.map((item) => item.command);

    expect(names).toContain("deploy");
    expect(names).not.toContain("init");
    expect(names).not.toContain("review");
    expect(catalog.lookup.init).toBeUndefined();
    expect(catalog.lookup.review).toBeUndefined();
    expect(catalog.lookup.deploy).toBe("deploy");
  });
});
