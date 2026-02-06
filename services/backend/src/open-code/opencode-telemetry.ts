/**
 * @fileoverview Utilities to summarize OpenCode message parts.
 *
 * Why:
 * - OpenCode returns rich parts (tool calls, patches, subtasks, etc).
 * - Telegram should receive a compact, factual trace (no chain-of-thought).
 *
 * Exports:
 * - OpenCodeTelemetry (L21) - Normalized summary structure.
 * - summarizeOpenCodeParts (L32) - Extracts tool/patch/subtask info.
 */

type ToolItem = { tool: string; state: string };
type PatchItem = { hash: string; files: string[] };
type FileChangeItem = {
  kind: "create" | "edit" | "delete";
  path: string;
  additions: number;
  deletions: number;
};
type CommandItem = {
  command: string;
  output: string;
};
type SubtaskItem = {
  description: string;
  agent: string;
  command?: string;
  model?: { providerID: string; modelID: string };
};

export type OpenCodeTelemetry = {
  tools: ToolItem[];
  patches: PatchItem[];
  fileChanges: FileChangeItem[];
  commands: CommandItem[];
  subtasks: SubtaskItem[];
};

export const summarizeOpenCodeParts = (parts: Array<{ type: string; [key: string]: unknown }>): OpenCodeTelemetry => {
  /* Keep only high-signal parts; never include reasoning text. */
  const tools: ToolItem[] = [];
  const patches: PatchItem[] = [];
  const fileChanges: FileChangeItem[] = [];
  const commands: CommandItem[] = [];
  const subtasks: SubtaskItem[] = [];

  for (const part of parts ?? []) {
    if (!part || typeof part.type !== "string") {
      continue;
    }

    if (part.type === "tool") {
      const tool = String((part as any).tool ?? "").trim();
      const state = String((part as any).state?.status ?? "").trim();
      if (tool) {
        tools.push({ tool, state: state || "unknown" });
      }

      const toolState = (part as any).state;
      if (tool === "bash" && toolState?.status === "completed") {
        const command = String(toolState?.input?.command ?? "").trim();
        const output = String(toolState?.output ?? "").trim();
        if (command) {
          commands.push({ command, output });
        }
      }

      if (tool === "edit" && toolState?.status === "completed") {
        const filediff = toolState?.metadata?.filediff;
        const targetPath = String(filediff?.file ?? "").trim();
        if (targetPath) {
          fileChanges.push({
            kind: "edit",
            path: targetPath,
            additions: Number(filediff?.additions ?? 0) || 0,
            deletions: Number(filediff?.deletions ?? 0) || 0
          });
        }
      }

      if (tool === "write" && toolState?.status === "completed") {
        const metadata = toolState?.metadata ?? {};
        const targetPath = String(metadata?.filepath ?? "").trim();
        const content = String(toolState?.input?.content ?? "");
        const additions = content.length > 0 ? content.split(/\r?\n/g).length : 0;
        const existed = Boolean(metadata?.exists);
        if (targetPath) {
          fileChanges.push({
            kind: existed ? "edit" : "create",
            path: targetPath,
            additions,
            deletions: 0
          });
        }
      }

      if (tool === "apply_patch" && toolState?.status === "completed") {
        const files = Array.isArray(toolState?.metadata?.files) ? toolState.metadata.files : [];
        files.forEach((file: any) => {
          const targetPath = String(file?.movePath ?? file?.filePath ?? "").trim();
          const kindRaw = String(file?.type ?? "update");
          const kind = kindRaw === "add" ? "create" : kindRaw === "delete" ? "delete" : "edit";
          if (!targetPath) {
            return;
          }
          fileChanges.push({
            kind,
            path: targetPath,
            additions: Number(file?.additions ?? 0) || 0,
            deletions: Number(file?.deletions ?? 0) || 0
          });
        });
      }

      continue;
    }

    if (part.type === "patch") {
      const hash = String((part as any).hash ?? "").trim();
      const files = Array.isArray((part as any).files) ? (part as any).files.map((f: any) => String(f)) : [];
      if (hash) {
        patches.push({ hash, files });
      }
      continue;
    }

    if (part.type === "subtask") {
      const description = String((part as any).description ?? "").trim();
      const agent = String((part as any).agent ?? "").trim();
      const commandRaw = (part as any).command;
      const command = typeof commandRaw === "string" ? commandRaw : undefined;
      const modelRaw = (part as any).model;
      const model =
        modelRaw && typeof modelRaw === "object"
          ? {
              providerID: String((modelRaw as any).providerID ?? ""),
              modelID: String((modelRaw as any).modelID ?? "")
            }
          : undefined;
      if (description || agent) {
        subtasks.push({ description, agent, command, model });
      }
    }
  }

  return { tools, patches, fileChanges, commands, subtasks };
};
