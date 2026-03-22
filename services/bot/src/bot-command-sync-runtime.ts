/**
 * @fileoverview Backend sync and startup helpers for bot command/runtime orchestration.
 *
 * Exports:
 * - COMMAND_SYNC_INTERVAL_MS - Periodic slash-command refresh interval.
 * - bindChatToTelegramStream - Persists the chat binding for one admin on backend.
 * - createCommandSyncRuntime - Owns slash-menu sync, alias lookup and periodic refresh timer.
 * - checkOpenCodeVersionOnBoot - Retries backend warmup check after runtime restarts.
 */

import { Telegraf } from "telegraf";

import { buildBotBackendHeaders } from "./backend-auth";
import { BotConfig } from "./config";
import { startPeriodicTask } from "./command-sync";
import { TelegramMenuCommand } from "./telegram-commands";
import { waitForOpenCodeVersionWarmup } from "./opencode-version-warmup";

export const COMMAND_SYNC_INTERVAL_MS = 60_000;

export const bindChatToTelegramStream = async (
  config: BotConfig,
  adminId: number,
  chatId: number
): Promise<void> => {
  /* Tell backend which chat should receive stream output for this admin. */
  const response = await fetch(`${config.backendUrl}/api/telegram/bind`, {
    method: "POST",
    headers: buildBotBackendHeaders(config, adminId, {
      "Content-Type": "application/json"
    }),
    body: JSON.stringify({ adminId, chatId })
  });

  if (!response.ok) {
    throw new Error(`Failed to bind chat: ${response.status} ${await response.text()}`);
  }
};

export const createCommandSyncRuntime = (input: {
  bot: Telegraf;
  config: BotConfig;
  intervalMs?: number;
}) => {
  let periodicCommandSyncStop: (() => void) | null = null;
  let opencodeCommandLookup = new Map<string, string>();

  const syncSlashCommands = async (adminId: number): Promise<void> => {
    /* Telegram suggests commands from setMyCommands, while lookup keeps local aliases normalized for forwarding. */
    const response = await fetch(`${input.config.backendUrl}/api/telegram/commands`, {
      headers: buildBotBackendHeaders(input.config, adminId)
    });

    if (!response.ok) {
      throw new Error(`Failed to sync commands: ${response.status}`);
    }

    const body = (await response.json()) as {
      commands?: TelegramMenuCommand[];
      lookup?: Record<string, string>;
    };

    const menuCommands = Array.isArray(body.commands) ? body.commands : [];
    opencodeCommandLookup = new Map(
      Object.entries(body.lookup ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[0] === "string" && typeof entry[1] === "string"
      )
    );

    await input.bot.telegram.setMyCommands(menuCommands);
  };

  const startPeriodicCommandSync = (adminId: number): void => {
    /* Refresh slash-menu periodically so Telegram suggestions stay aligned with backend command catalog. */
    periodicCommandSyncStop?.();
    const controller = startPeriodicTask({
      intervalMs: input.intervalMs ?? COMMAND_SYNC_INTERVAL_MS,
      run: async () => {
        await syncSlashCommands(adminId);
      },
      onError: (error) => {
        // eslint-disable-next-line no-console
        console.error("Periodic slash sync failed", error);
      }
    });

    periodicCommandSyncStop = controller.stop;
  };

  const stopPeriodicCommandSync = (): void => {
    /* Ensure timer cleanup during shutdown/reload so duplicate sync loops never accumulate. */
    periodicCommandSyncStop?.();
    periodicCommandSyncStop = null;
  };

  const resolveCommandAlias = (command: string): string | undefined => {
    /* Text-command forwarding resolves Telegram-visible aliases to backend OpenCode command ids. */
    return opencodeCommandLookup.get(command);
  };

  return {
    syncSlashCommands,
    startPeriodicCommandSync,
    stopPeriodicCommandSync,
    resolveCommandAlias
  };
};

export const checkOpenCodeVersionOnBoot = async (config: BotConfig, adminId: number): Promise<void> => {
  /* Deploy restarts can bring backend and OpenCode up a few seconds after the bot process itself. */
  try {
    await waitForOpenCodeVersionWarmup({
      run: async () => {
        const response = await fetch(`${config.backendUrl}/api/telegram/opencode/version/check`, {
          method: "POST",
          headers: buildBotBackendHeaders(config, adminId, {
            "Content-Type": "application/json"
          }),
          body: "{}"
        });

        if (!response.ok) {
          throw new Error(`status=${response.status}`);
        }
      },
      onRetry: ({ attempt, maxAttempts, error }) => {
        // eslint-disable-next-line no-console
        console.warn(
          `OpenCode version warmup retry ${attempt}/${maxAttempts} after transient startup failure`,
          error
        );
      }
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("OpenCode version check on boot failed", error);
  }
};
