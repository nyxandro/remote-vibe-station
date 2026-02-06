/**
 * @fileoverview Domain service for Telegram execution preferences.
 *
 * Exports:
 * - TelegramPreferencesService (L21) - Validate, read, and update preferences.
 */

import { Injectable } from "@nestjs/common";

import {
  OpenCodeAgent,
  OpenCodeExecutionModel,
  OpenCodeProviderModel,
  OpenCodeProviderSummary
} from "../../open-code/opencode.types";
import { OpenCodeClient } from "../../open-code/opencode-client";
import { OpenCodeSettingsService } from "../../opencode/opencode-settings.service";
import { AdminPreferences, SettingsSnapshot } from "./telegram-preferences.types";
import { TelegramPreferencesStore } from "./telegram-preferences.store";

const DEFAULT_TELEGRAM_AGENTS = new Set(["build", "plan"]);

@Injectable()
export class TelegramPreferencesService {
  public constructor(
    private readonly store: TelegramPreferencesStore,
    private readonly opencode: OpenCodeClient,
    private readonly opencodeSettings: OpenCodeSettingsService
  ) {}

  public async getSettings(adminId: number): Promise<SettingsSnapshot> {
    /* Build a UI snapshot with validated selected values and options. */
    const providers = await this.opencode.listProviders();
    const agents = await this.listTelegramAgents();
    const persisted = this.store.get(adminId);

    const selectedModel = await this.resolveSelectedModel(persisted, providers);
    const models = await this.opencode.listModels(selectedModel.providerID);
    const selectedModelInfo = this.findModelOrThrow(models, selectedModel.modelID);

    const selectedThinking = this.resolveThinking(persisted.thinking, selectedModelInfo);
    const selectedAgent = this.resolveAgent(persisted.agent, agents);

    return {
      selected: {
        model: selectedModel,
        thinking: selectedThinking,
        agent: selectedAgent
      },
      providers,
      models,
      agents,
      thinkingOptions: selectedModelInfo.variants
    };
  }

  public async listModels(providerID: string): Promise<OpenCodeProviderModel[]> {
    /* Used by Telegram model picker screen when provider changes. */
    const providers = await this.opencode.listProviders();
    if (!providers.some((item) => item.id === providerID)) {
      throw new Error(`Unknown provider: ${providerID}`);
    }
    return this.opencode.listModels(providerID);
  }

  public async updateSettings(
    adminId: number,
    input: { providerID?: string; modelID?: string; thinking?: string | null; agent?: string | null }
  ): Promise<SettingsSnapshot> {
    /* Update settings atomically after validating against OpenCode options. */
    const providers = await this.opencode.listProviders();
    const agents = await this.listTelegramAgents();
    const prev = this.store.get(adminId);

    const hasModelUpdate = typeof input.providerID === "string" || typeof input.modelID === "string";
    if (hasModelUpdate && (!input.providerID || !input.modelID)) {
      throw new Error("providerID and modelID must be provided together");
    }

    const nextModel = hasModelUpdate
      ? this.validateModel(providers, input.providerID!, input.modelID!)
      : await this.resolveSelectedModel(prev, providers);

    const models = await this.opencode.listModels(nextModel.providerID);
    const nextModelInfo = this.findModelOrThrow(models, nextModel.modelID);

    const nextThinking =
      typeof input.thinking !== "undefined"
        ? this.validateThinking(input.thinking, nextModelInfo)
        : this.resolveThinking(prev.thinking, nextModelInfo);

    const nextAgent =
      typeof input.agent !== "undefined" ? this.validateAgent(input.agent, agents) : this.resolveAgent(prev.agent, agents);

    this.store.set(adminId, {
      model: nextModel,
      thinking: nextThinking,
      agent: nextAgent
    });

    return {
      selected: { model: nextModel, thinking: nextThinking, agent: nextAgent },
      providers,
      models,
      agents,
      thinkingOptions: nextModelInfo.variants
    };
  }

  public async getExecutionSettings(adminId: number): Promise<{
    model: OpenCodeExecutionModel;
    agent: string | null;
  }> {
    /* Resolve model/agent to inject into OpenCode message requests. */
    const providers = await this.opencode.listProviders();
    const persisted = this.store.get(adminId);
    const selectedModel = await this.resolveSelectedModel(persisted, providers);
    const models = await this.opencode.listModels(selectedModel.providerID);
    const selectedModelInfo = this.findModelOrThrow(models, selectedModel.modelID);
    const thinking = this.resolveThinking(persisted.thinking, selectedModelInfo);

    return {
      model: {
        providerID: selectedModel.providerID,
        modelID: selectedModel.modelID,
        variant: thinking ?? undefined
      },
      agent: persisted.agent ?? null
    };
  }

  private async resolveSelectedModel(
    persisted: AdminPreferences,
    providers: OpenCodeProviderSummary[]
  ): Promise<OpenCodeExecutionModel> {
    /* Use persisted model or OpenCode default model as baseline. */
    const selected = persisted.model ?? (await this.opencode.getDefaultModel());
    return this.validateModel(providers, selected.providerID, selected.modelID);
  }

  private validateModel(
    providers: OpenCodeProviderSummary[],
    providerID: string,
    modelID: string
  ): OpenCodeExecutionModel {
    /* Ensure provider and model exist on the active OpenCode server. */
    const provider = providers.find((item) => item.id === providerID);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerID}`);
    }

    return { providerID, modelID };
  }

  private findModelOrThrow(models: OpenCodeProviderModel[], modelID: string): OpenCodeProviderModel {
    /* Validate model ID for the already selected provider. */
    const model = models.find((item) => item.id === modelID);
    if (!model) {
      throw new Error(`Unknown model for provider: ${modelID}`);
    }
    return model;
  }

  private resolveThinking(
    thinking: string | null | undefined,
    model: OpenCodeProviderModel
  ): string | null {
    /* Keep only valid variants for the selected model. */
    if (!thinking) {
      return null;
    }
    return model.variants.includes(thinking) ? thinking : null;
  }

  private validateThinking(
    thinking: string | null,
    model: OpenCodeProviderModel
  ): string | null {
    /* Validate explicit thinking selection from Telegram UI payload. */
    if (!thinking) {
      return null;
    }
    if (!model.variants.includes(thinking)) {
      throw new Error(`Thinking level is not available for model: ${thinking}`);
    }
    return thinking;
  }

  private resolveAgent(agent: string | null | undefined, agents: OpenCodeAgent[]): string | null {
    /* Keep persisted agent only when it still exists on the server. */
    if (!agent) {
      return null;
    }
    return agents.some((item) => item.name === agent) ? agent : null;
  }

  private validateAgent(agent: string | null, agents: OpenCodeAgent[]): string | null {
    /* Validate explicit Telegram agent selection. */
    if (!agent) {
      return null;
    }
    if (!agents.some((item) => item.name === agent)) {
      throw new Error(`Unknown agent: ${agent}`);
    }
    return agent;
  }

  private async listTelegramAgents(): Promise<OpenCodeAgent[]> {
    /*
     * Telegram picker should expose only build/plan + user custom agents.
     * This hides internal/system agents returned by OpenCode runtime.
     */
    const allAgents = await this.opencode.listAgents();
    const customNames = new Set(this.opencodeSettings.listCustomAgentNames());
    return allAgents.filter(
      (item) => DEFAULT_TELEGRAM_AGENTS.has(item.name) || customNames.has(item.name)
    );
  }
}
