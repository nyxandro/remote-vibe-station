/**
 * @fileoverview Aggregates bot-local and OpenCode commands for Telegram menu sync.
 *
 * Exports:
 * - TelegramMenuCommand (L16) - Telegram API command item shape.
 * - TelegramCommandCatalog (L21) - Merged menu plus lookup map and active skill list for bot routing.
 * - TelegramCommandCatalogService (L31) - Builds normalized command catalog for admin/project context.
 */

import { Injectable } from "@nestjs/common";

import { PromptService } from "../prompt/prompt.service";

export type TelegramMenuCommand = {
  command: string;
  description: string;
};

export type TelegramCommandCatalog = {
  commands: TelegramMenuCommand[];
  lookup: Record<string, string>;
  skills: string[];
};

const TELEGRAM_COMMAND_REGEX = /^[a-z0-9_]{1,32}$/;
const TELEGRAM_DESCRIPTION_MAX = 256;
const EXCLUDED_OPENCODE_COMMANDS = new Set(["init", "review"]);
const SKILL_COMMAND_NAMES = new Set([
  "cache_components",
  "ccs_delegation",
  "docx",
  "frontend_skill",
  "pdf",
  "pptx",
  "pretty_mermaid",
  "seo_review",
  "vercel_react_best_practices",
  "xlsx",
  "yandex_wordstat"
]);

const BOT_LOCAL_COMMANDS: TelegramMenuCommand[] = [
  { command: "start", description: "Запуск бота и справка" },
  { command: "access", description: "Ссылка во внешний OpenCode UI" },
  { command: "mode", description: "Настроить model/agent" },
  { command: "chat", description: "Включить стрим ответов" },
  { command: "end", description: "Выключить стрим ответов" },
  { command: "stop", description: "Остановить текущий запрос" },
  { command: "new", description: "Начать новую сессию" },
  { command: "sessions", description: "Выбрать сессию" },
  { command: "repair", description: "Починить зависшие сессии" },
  { command: "projects", description: "Список проектов" },
  { command: "project", description: "Выбрать активный проект" }
];

@Injectable()
export class TelegramCommandCatalogService {
  public constructor(private readonly prompts: PromptService) {}

  public async listForAdmin(adminId: number): Promise<TelegramCommandCatalog> {
    /* Load available OpenCode commands for active project (or global fallback). */
    const openCodeCommands = await this.prompts.listAvailableCommands(adminId);

    /* Keep insertion order deterministic: local commands first, dynamic commands after. */
    const menuMap = new Map<string, TelegramMenuCommand>();
    const lookup = new Map<string, string>();
    const skills = new Set<string>();

    BOT_LOCAL_COMMANDS.forEach((item) => {
      menuMap.set(item.command, item);
      lookup.set(item.command, item.command);
    });

    openCodeCommands.forEach((item) => {
      /* Hide selected OpenCode maintenance commands from Telegram bridge. */
      if (EXCLUDED_OPENCODE_COMMANDS.has(item.name)) {
        return;
      }

      lookup.set(item.name, item.name);

      const telegramName = this.toTelegramCommandName(item.name);
      if (!telegramName) {
        return;
      }

      lookup.set(telegramName, item.name);
      if (SKILL_COMMAND_NAMES.has(telegramName)) {
        /* Skill slash commands stay callable via manual input, but should not appear in Telegram command menu. */
        skills.add(telegramName);
        return;
      }

      if (!menuMap.has(telegramName)) {
        menuMap.set(telegramName, {
          command: telegramName,
          description: this.toTelegramDescription(item.description)
        });
      }
    });

    return {
      commands: Array.from(menuMap.values()),
      lookup: Object.fromEntries(lookup.entries()),
      skills: Array.from(skills.values())
    };
  }

  private toTelegramCommandName(name: string): string | null {
    /* Telegram menu supports only [a-z0-9_]; map dash names to underscore alias. */
    if (this.isTelegramCommandName(name)) {
      return name;
    }

    if (/^[a-z0-9-]{1,32}$/.test(name)) {
      const alias = name.replaceAll("-", "_");
      if (this.isTelegramCommandName(alias)) {
        return alias;
      }
    }

    return null;
  }

  private toTelegramDescription(description: string | undefined): string {
    /* Telegram hard-limits command descriptions to 256 characters. */
    const normalized = (description ?? "Команда OpenCode").trim();
    if (normalized.length <= TELEGRAM_DESCRIPTION_MAX) {
      return normalized;
    }
    return normalized.slice(0, TELEGRAM_DESCRIPTION_MAX).trimEnd();
  }

  private isTelegramCommandName(value: string): boolean {
    /* Keep strict validation to prevent setMyCommands API rejections. */
    return TELEGRAM_COMMAND_REGEX.test(value);
  }
}
