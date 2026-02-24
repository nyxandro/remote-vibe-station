/**
 * @fileoverview Telegram slash-command utilities for OpenCode integration.
 *
 * Exports:
 * - TelegramMenuCommand (L16) - Minimal command shape accepted by Telegram API.
 * - OpenCodeCommand (L21) - OpenCode command metadata from backend API.
 * - BOT_LOCAL_COMMANDS (L26) - Bot-owned commands shown in Telegram menu.
 * - BOT_LOCAL_COMMAND_NAMES (L42) - Set of commands handled by local bot handlers.
 * - buildTelegramMenuCommands (L80) - Merge local and OpenCode commands for menu.
 * - parseSlashCommand (L128) - Parse incoming slash command and arguments.
 */

const TELEGRAM_COMMAND_REGEX = /^[a-z0-9_]{1,32}$/;
const TELEGRAM_DESCRIPTION_MAX = 256;

export type TelegramMenuCommand = {
  command: string;
  description: string;
};

export type OpenCodeCommand = {
  name: string;
  description?: string;
};

export const BOT_LOCAL_COMMANDS: TelegramMenuCommand[] = [
  /* Entry point and Mini App access. */
  { command: "start", description: "Запуск бота и справка" },
  { command: "open", description: "Открыть Mini App" },
  { command: "access", description: "Ссылка во внешний OpenCode UI" },
  { command: "mode", description: "Настроить model/agent" },
  /* Stream management commands required by product flow. */
  { command: "chat", description: "Включить стрим ответов" },
  { command: "end", description: "Выключить стрим ответов" },
  { command: "new", description: "Начать новую сессию" },
  { command: "sessions", description: "Выбрать сессию" },
  { command: "repair", description: "Починить зависшие сессии" },
  /* Project selection helpers for active workspace. */
  { command: "projects", description: "Список проектов" },
  { command: "project", description: "Выбрать активный проект" }
];

export const BOT_LOCAL_COMMAND_NAMES = new Set(BOT_LOCAL_COMMANDS.map((item) => item.command));

const toTelegramCommandName = (name: string): string | null => {
  /*
   * Telegram does not allow dashes in command names.
   * We expose dash commands via underscore alias to keep them discoverable.
   */
  if (isTelegramCommandName(name)) {
    return name;
  }

  if (/^[a-z0-9-]{1,32}$/.test(name)) {
    const alias = name.replaceAll("-", "_");
    if (isTelegramCommandName(alias)) {
      return alias;
    }
  }

  return null;
};

const toTelegramDescription = (description: string | undefined): string => {
  /* Telegram limits command descriptions to 256 characters. */
  const normalized = (description ?? "Команда OpenCode").trim();
  if (normalized.length <= TELEGRAM_DESCRIPTION_MAX) {
    return normalized;
  }
  return normalized.slice(0, TELEGRAM_DESCRIPTION_MAX).trimEnd();
};

const isTelegramCommandName = (value: string): boolean => {
  /*
   * We keep strict validation to avoid API rejections from setMyCommands.
   * Invalid names are skipped from Telegram menu but can still be executed manually.
   */
  return TELEGRAM_COMMAND_REGEX.test(value);
};

export const buildTelegramMenuCommands = (
  opencodeCommands: OpenCodeCommand[]
): TelegramMenuCommand[] => {
  /* Keep insertion order stable: local commands first, then OpenCode commands. */
  const map = new Map<string, TelegramMenuCommand>();

  BOT_LOCAL_COMMANDS.forEach((item) => {
    map.set(item.command, item);
  });

  opencodeCommands.forEach((item) => {
    const telegramCommandName = toTelegramCommandName(item.name);
    if (!telegramCommandName) {
      return;
    }

    if (!map.has(telegramCommandName)) {
      map.set(telegramCommandName, {
        command: telegramCommandName,
        description: toTelegramDescription(item.description)
      });
    }
  });

  return Array.from(map.values());
};

export const buildOpenCodeCommandLookup = (opencodeCommands: OpenCodeCommand[]): Map<string, string> => {
  /* Build a lookup that resolves Telegram aliases back to original OpenCode names. */
  const lookup = new Map<string, string>();

  opencodeCommands.forEach((item) => {
    lookup.set(item.name, item.name);

    const telegramCommandName = toTelegramCommandName(item.name);
    if (telegramCommandName) {
      lookup.set(telegramCommandName, item.name);
    }
  });

  return lookup;
};

type ParsedSlashCommand = {
  command: string;
  args: string[];
};

export const parseSlashCommand = (text: string): ParsedSlashCommand | null => {
  /* Extract `/command` and split positional arguments by whitespace. */
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const parts = trimmed.split(/\s+/g);
  const head = parts[0].slice(1).toLowerCase();
  const command = head.split("@")[0];
  if (!command || !TELEGRAM_COMMAND_REGEX.test(command)) {
    return null;
  }

  return {
    command,
    args: parts.slice(1)
  };
};
