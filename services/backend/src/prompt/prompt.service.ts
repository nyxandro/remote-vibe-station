/**
 * @fileoverview Service for handling prompt requests.
 *
 * Exports:
 * - PromptResult (L14) - Result shape for prompt processing.
 * - PromptService (L19) - Sends prompts to OpenCode and emits events.
 */

import { Injectable } from "@nestjs/common";

import { EventsService } from "../events/events.service";
import { OpenCodeCommand, OpenCodeExecutionModel } from "../open-code/opencode.types";
import { OpenCodeClient } from "../open-code/opencode-client";
import { OpenCodeEventsService } from "../open-code/opencode-events.service";
import { summarizeOpenCodeParts } from "../open-code/opencode-telemetry";
import { OpenCodeSessionRoutingStore } from "../open-code/opencode-session-routing.store";
import { ProjectsService } from "../projects/projects.service";
import { TelegramPreferencesService } from "../telegram/preferences/telegram-preferences.service";

type PromptResult = {
  sessionId: string;
  responseText: string;
  model: {
    providerID: string;
    modelID: string;
    providerName?: string;
    modelName?: string;
    contextLimit?: number;
  };
  mode: string;
  agent: string;
  tokens: { input: number; output: number; reasoning: number };
};

@Injectable()
export class PromptService {
  public constructor(
    private readonly opencode: OpenCodeClient,
    private readonly events: EventsService,
    private readonly projects: ProjectsService,
    private readonly preferences: TelegramPreferencesService,
    private readonly sessionRouting: OpenCodeSessionRoutingStore,
    private readonly opencodeEvents: OpenCodeEventsService
  ) {}

  public async sendPrompt(text: string, adminId?: number): Promise<PromptResult> {
    /* Require active project to avoid using OpenCode global workspace. */
    const active = await this.projects.getActiveProject(adminId);
    if (!active) {
      throw new Error("No active project selected. Use /project <slug> or select in Mini App.");
    }

    /* Emit prompt start event. */
    this.events.publish({
      type: "opencode.prompt",
      ts: new Date().toISOString(),
      data: { text, projectSlug: active.slug, directory: active.rootPath, adminId: adminId ?? null }
    });

    /* Resolve per-admin execution preferences (model/thinking/agent). */
    const execution: {
      model: OpenCodeExecutionModel;
      agent: string | null;
    } = adminId
      ? await this.preferences.getExecutionSettings(adminId)
      : {
          model: { ...(await this.opencode.getDefaultModel()) },
          agent: null
        };

    /* Ensure runtime SSE subscription for the active project directory. */
    this.opencodeEvents.ensureDirectory(active.rootPath);

    /* Send prompt to OpenCode and gather response. */
    const result = await this.opencode.sendPrompt(text, {
      directory: active.rootPath,
      model: execution.model,
      agent: execution.agent,
      onSessionResolved: (sessionID) => {
        if (adminId) {
          this.sessionRouting.bind(sessionID, { adminId, directory: active.rootPath });
        }
      }
    });

    return this.publishMessageResult(result, {
      activeProject: active,
      adminId,
      thinking: execution.model.variant ?? null
    });
  }

  public async listAvailableCommands(adminId?: number): Promise<OpenCodeCommand[]> {
    /*
     * If an active project exists, include project-level custom commands.
     * Otherwise return global commands from OpenCode defaults.
     */
    const active = await this.projects.getActiveProject(adminId);
    if (!active) {
      return this.opencode.listCommands();
    }

    return this.opencode.listCommands({ directory: active.rootPath });
  }

  public async executeCommand(
    input: { command: string; arguments: string[] },
    adminId?: number
  ): Promise<PromptResult> {
    /* Slash commands are executed in the active project context. */
    const active = await this.projects.getActiveProject(adminId);
    if (!active) {
      throw new Error("No active project selected. Use /project <slug> or select in Mini App.");
    }

    /* Emit command start event to preserve observability parity with prompt flow. */
    const promptText = `/${input.command}${input.arguments.length > 0 ? ` ${input.arguments.join(" ")}` : ""}`;
    this.events.publish({
      type: "opencode.prompt",
      ts: new Date().toISOString(),
      data: { text: promptText, projectSlug: active.slug, directory: active.rootPath, adminId: adminId ?? null }
    });

    /* Ensure runtime SSE subscription for command execution directory. */
    this.opencodeEvents.ensureDirectory(active.rootPath);

    const result = await this.opencode.executeCommand(input, {
      directory: active.rootPath,
      onSessionResolved: (sessionID) => {
        if (adminId) {
          this.sessionRouting.bind(sessionID, { adminId, directory: active.rootPath });
        }
      }
    });
    return this.publishMessageResult(result, {
      activeProject: active,
      adminId,
      thinking: null
    });
  }

  private async publishMessageResult(
    result: Awaited<ReturnType<OpenCodeClient["sendPrompt"]>>,
    context: {
      activeProject: { slug: string; rootPath: string };
      adminId?: number;
      thinking: string | null;
    }
  ): Promise<PromptResult> {
    /* Reuse one path for telemetry enrichment and outbound events. */
    const active = context.activeProject;

    /* Resolve model limit/display names for token footer (best-effort). */
    const contextLimit = await this.opencode
      .getModelContextLimit({ providerID: result.info.providerID, modelID: result.info.modelID })
      .then((v) => v?.context ?? undefined)
      .catch(() => undefined);

    const names = await this.opencode
      .getModelDisplayName({ providerID: result.info.providerID, modelID: result.info.modelID })
      .catch(() => null);

    /* Summarize parts into a compact telemetry payload for Telegram. */
    const telemetry = summarizeOpenCodeParts(result.parts);

    /* Emit message event for downstream consumers. */
    this.events.publish({
      type: "opencode.message",
      ts: new Date().toISOString(),
      data: {
        text: result.responseText,
        sessionId: result.sessionId,
        projectSlug: active.slug,
        directory: active.rootPath,
        adminId: context.adminId ?? null,
        providerID: result.info.providerID,
        modelID: result.info.modelID,
        providerName: names?.providerName ?? null,
        modelName: names?.modelName ?? null,
        contextLimit: contextLimit ?? null,
        thinking: context.thinking,
        mode: result.info.mode,
        agent: result.info.agent,
        tokens: result.info.tokens,
        telemetry
      }
    });

    return {
      sessionId: result.sessionId,
      responseText: result.responseText,
      model: {
        providerID: result.info.providerID,
        modelID: result.info.modelID,
        providerName: names?.providerName,
        modelName: names?.modelName,
        contextLimit
      },
      mode: result.info.mode,
      agent: result.info.agent,
      tokens: {
        input: result.info.tokens?.input ?? 0,
        output: result.info.tokens?.output ?? 0,
        reasoning: result.info.tokens?.reasoning ?? 0
      }
    };
  }
}
