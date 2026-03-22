/**
 * @fileoverview Shared final OpenCode reply publisher for Telegram/event consumers.
 *
 * Exports:
 * - PublishedOpenCodeReplySummary - Resolved model metadata returned after publishing.
 * - OpenCodeFinalMessageService - Publishes normalized opencode.message events for prompt and runner flows.
 */

import { Injectable } from "@nestjs/common";

import { EventsService } from "../events/events.service";
import { summarizeOpenCodeParts } from "./opencode-telemetry";
import { extractFinalOpenCodeText } from "./opencode-text-parts";
import { OpenCodeClient } from "./opencode-client";
import { OpenCodeAssistantTokens, OpenCodePart } from "./opencode.types";

export type PublishedOpenCodeReplySummary = {
  finalText: string;
  contextLimit?: number;
  providerName?: string;
  modelName?: string;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
  };
};

@Injectable()
export class OpenCodeFinalMessageService {
  public constructor(
    private readonly opencode: OpenCodeClient,
    private readonly events: EventsService
  ) {}

  public async publish(input: {
    sessionId: string;
    responseText: string;
    parts: OpenCodePart[];
    info: {
      providerID: string;
      modelID: string;
      mode: string;
      agent: string;
      tokens: OpenCodeAssistantTokens;
    };
    activeProject: { slug: string; rootPath: string };
    adminId?: number;
    thinking: string | null;
  }): Promise<PublishedOpenCodeReplySummary> {
    /* Resolve model metadata best-effort so Telegram footer stays informative without breaking reply delivery. */
    const contextLimit =
      typeof (this.opencode as Partial<OpenCodeClient>).getModelContextLimit === "function"
        ? await this.opencode
            .getModelContextLimit({ providerID: input.info.providerID, modelID: input.info.modelID })
            .then((value) => value?.context ?? undefined)
            .catch(() => undefined)
        : undefined;

    /* Display names are optional enrichment only, so event publication must continue if lookup fails. */
    const names =
      typeof (this.opencode as Partial<OpenCodeClient>).getModelDisplayName === "function"
        ? await this.opencode
            .getModelDisplayName({ providerID: input.info.providerID, modelID: input.info.modelID })
            .catch(() => null)
        : null;

    /* Final text must prefer the last assistant text block so streamed commentary does not reappear in the final bubble. */
    const telemetry = summarizeOpenCodeParts(input.parts);
    const finalText = extractFinalOpenCodeText(input.parts) || input.responseText;

    /* Publish one normalized final-reply event for all downstream Telegram/runtime consumers. */
    this.events.publish({
      type: "opencode.message",
      ts: new Date().toISOString(),
      data: {
        text: input.responseText,
        sessionId: input.sessionId,
        projectSlug: input.activeProject.slug,
        directory: input.activeProject.rootPath,
        adminId: input.adminId ?? null,
        finalText,
        providerID: input.info.providerID,
        modelID: input.info.modelID,
        providerName: names?.providerName ?? null,
        modelName: names?.modelName ?? null,
        contextLimit: contextLimit ?? null,
        thinking: input.thinking,
        mode: input.info.mode,
        agent: input.info.agent,
        tokens: input.info.tokens,
        telemetry
      }
    });

    return {
      finalText,
      contextLimit,
      providerName: names?.providerName,
      modelName: names?.modelName,
      tokens: {
        input: input.info.tokens?.input ?? 0,
        output: input.info.tokens?.output ?? 0,
        reasoning: input.info.tokens?.reasoning ?? 0
      }
    };
  }
}
