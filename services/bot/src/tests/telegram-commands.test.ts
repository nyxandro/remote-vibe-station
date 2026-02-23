/**
 * @fileoverview Tests for Telegram slash-command mapping/parsing.
 *
 * Exports:
 * - (none)
 */

import {
  BOT_LOCAL_COMMANDS,
  buildOpenCodeCommandLookup,
  buildTelegramMenuCommands,
  parseSlashCommand
} from "../telegram-commands";

describe("buildTelegramMenuCommands", () => {
  it("includes local bot commands and OpenCode commands", () => {
    /*
     * Telegram supports only [a-z0-9_] command names.
     * Invalid names from OpenCode must be skipped.
     */
    const commands = buildTelegramMenuCommands([
      { name: "help", description: "Show help" },
      { name: "review_changes", description: "Review changes" },
      { name: "bad-command", description: "Invalid for Telegram" }
    ]);

    const names = commands.map((item) => item.command);
    expect(names).toEqual(
      expect.arrayContaining([
        "start",
        "mode",
        "chat",
        "end",
        "help",
        "review_changes",
        "bad_command"
      ])
    );
    expect(names).not.toContain("bad-command");

    /* Ensure local commands are not lost on merge. */
    expect(names).toEqual(expect.arrayContaining(BOT_LOCAL_COMMANDS.map((item) => item.command)));
  });

  it("deduplicates repeated command names", () => {
    const commands = buildTelegramMenuCommands([
      { name: "help", description: "Show help from OpenCode" },
      { name: "help", description: "Duplicate" }
    ]);

    const helpItems = commands.filter((item) => item.command === "help");
    expect(helpItems).toHaveLength(1);
  });
});

describe("buildOpenCodeCommandLookup", () => {
  it("maps Telegram alias to original OpenCode command name", () => {
    const lookup = buildOpenCodeCommandLookup([
      { name: "review-changes", description: "Review" },
      { name: "help", description: "Help" }
    ]);

    expect(lookup.get("review_changes")).toBe("review-changes");
    expect(lookup.get("help")).toBe("help");
  });
});

describe("parseSlashCommand", () => {
  it("parses slash command with arguments", () => {
    const parsed = parseSlashCommand("/review_changes src/main.ts");

    expect(parsed).toEqual({
      command: "review_changes",
      args: ["src/main.ts"]
    });
  });

  it("supports Telegram @bot suffix and strips it", () => {
    const parsed = parseSlashCommand("/help@my_bot");
    expect(parsed).toEqual({ command: "help", args: [] });
  });

  it("returns null for non-command text", () => {
    expect(parseSlashCommand("hello world")).toBeNull();
  });
});
