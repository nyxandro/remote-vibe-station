/**
 * @fileoverview Startup summary loader/formatter for Telegram /start response.
 *
 * Exports:
 * - StartupSummary (L14) - Structured payload returned by backend startup-summary endpoint.
 * - fetchStartupSummary (L41) - Loads startup summary for an admin from backend.
 * - buildStartSummaryMessage (L54) - Renders operator-facing /start message text.
 */

export type StartupSummary = {
  project: {
    slug: string;
    rootPath: string;
  } | null;
  git: {
    filesChanged: number;
    additions: number;
    deletions: number;
  } | null;
  mode: {
    providerID: string;
    modelID: string;
    thinking: string | null;
    agent: string | null;
  };
  commands: Array<{
    command: string;
    description: string;
  }>;
};

const COMMANDS_PREVIEW_LIMIT = 40;

export const fetchStartupSummary = async (
  backendUrl: string,
  adminId: number
): Promise<StartupSummary> => {
  /* Request a single backend payload so /start is fast and consistent. */
  const response = await fetch(`${backendUrl}/api/telegram/startup-summary`, {
    headers: { "x-admin-id": String(adminId) }
  });

  if (!response.ok) {
    throw new Error(`Failed to load startup summary: ${response.status}`);
  }

  return (await response.json()) as StartupSummary;
};

export const buildStartSummaryMessage = (summary: StartupSummary): string => {
  /* Project and git section tell operator where work is routed and repo state. */
  const projectLine = summary.project
    ? `Текущий проект: ${summary.project.slug}`
    : "Текущий проект: не выбран";
  const gitLine = summary.project
    ? summary.git
      ? `Незакоммиченные изменения: ${summary.git.filesChanged} файлов (+${summary.git.additions}/-${summary.git.deletions})`
      : "Незакоммиченные изменения: нет"
    : "Незакоммиченные изменения: нет данных (проект не выбран)";

  /* Mode section reflects exact model/agent/thinking that will be used on next prompt. */
  const agent = summary.mode.agent ?? "build (default)";
  const thinking = summary.mode.thinking ?? "default";
  const modeLine =
    `Режим: model=${summary.mode.providerID}/${summary.mode.modelID}, ` +
    `agent=${agent}, thinking=${thinking}`;

  /* Command section exposes currently available slash menu in Telegram context. */
  const visibleCommands = summary.commands.slice(0, COMMANDS_PREVIEW_LIMIT);
  const commandLines =
    visibleCommands.length > 0
      ? visibleCommands.map((item) => `- /${item.command} - ${item.description}`)
      : ["Доступные команды: нет"];

  const lines = ["Привет!", projectLine, gitLine, modeLine, "", "Доступные команды:", ...commandLines];
  if (summary.commands.length > COMMANDS_PREVIEW_LIMIT) {
    lines.push(`... и еще ${summary.commands.length - COMMANDS_PREVIEW_LIMIT}`);
  }

  return lines.join("\n");
};
