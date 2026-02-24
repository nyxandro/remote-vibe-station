/**
 * @fileoverview Telegram /repair command wiring.
 *
 * Exports:
 * - registerRepairCommand (L61) - Registers command that triggers backend session recovery.
 */

import { Telegraf } from "telegraf";

import { buildBackendErrorMessage } from "./backend-error";
import { BotConfig } from "./config";

type RepairSummary = {
  ok: true;
  projectSlug: string;
  directory: string;
  busyTimeoutMs: number;
  scanned: number;
  busy: number;
  aborted: string[];
};

const parseRepairSummary = (payload: unknown): RepairSummary => {
  /* Validate backend payload strictly to avoid posting misleading recovery stats. */
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Некорректный ответ recovery");
  }

  const record = payload as Record<string, unknown>;
  if (record.ok !== true) {
    throw new Error("Recovery не подтвержден backend");
  }

  if (typeof record.projectSlug !== "string" || typeof record.directory !== "string") {
    throw new Error("Recovery ответ не содержит проект");
  }

  if (
    typeof record.busyTimeoutMs !== "number" ||
    typeof record.scanned !== "number" ||
    typeof record.busy !== "number" ||
    !Array.isArray(record.aborted)
  ) {
    throw new Error("Recovery ответ не содержит счетчики");
  }

  const aborted = record.aborted.filter((item): item is string => typeof item === "string");
  return {
    ok: true,
    projectSlug: record.projectSlug,
    directory: record.directory,
    busyTimeoutMs: record.busyTimeoutMs,
    scanned: record.scanned,
    busy: record.busy,
    aborted
  };
};

export const registerRepairCommand = (input: {
  bot: Telegraf;
  config: BotConfig;
  isAdmin: (id: number | undefined) => boolean;
}): void => {
  /* Register explicit manual recovery command for stuck OpenCode sessions. */
  input.bot.command("repair", async (ctx) => {
    if (!input.isAdmin(ctx.from?.id)) {
      await ctx.reply("Access denied");
      return;
    }

    const adminId = Number(ctx.from?.id);
    const response = await fetch(`${input.config.backendUrl}/api/telegram/repair`, {
      method: "POST",
      headers: {
        "x-admin-id": String(adminId)
      }
    });

    if (!response.ok) {
      const body = await response.text();
      await ctx.reply(buildBackendErrorMessage(response.status, body));
      return;
    }

    const summary = parseRepairSummary(await response.json());
    const timeoutSeconds = Math.round(summary.busyTimeoutMs / 1000);
    const abortedLine = summary.aborted.length > 0 ? summary.aborted.join(", ") : "нет";

    await ctx.reply(
      `/repair завершен (${summary.projectSlug})\n` +
        `таймаут: ${timeoutSeconds}с\n` +
        `проверено: ${summary.scanned}, busy: ${summary.busy}\n` +
        `прерваны: ${abortedLine}`
    );
  });
};
