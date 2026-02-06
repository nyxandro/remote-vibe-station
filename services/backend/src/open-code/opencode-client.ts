/**
 * @fileoverview OpenCode HTTP client for sessions and prompts.
 *
 * Exports:
 * - PromptResult (L14) - Prompt response shape.
 * - OpenCodeClient (L19) - Sends prompts and manages sessions.
 */

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import {
  OpenCodeAgent,
  OpenCodeAssistantTokens,
  OpenCodeCommand,
  OpenCodeExecutionModel,
  OpenCodeMessageResponse,
  OpenCodePart,
  OpenCodeProviderModel,
  OpenCodeProviderSummary
} from "./opencode.types";

type PromptResult = {
  sessionId: string;
  responseText: string;
  info: {
    providerID: string;
    modelID: string;
    mode: string;
    agent: string;
    tokens: OpenCodeAssistantTokens;
  };
  parts: OpenCodePart[];
};

type OpenCodeProvidersConfig = {
  default?: Record<string, string>;
};

type OpenCodeProvidersResponse = {
  all?: Array<{
    id?: string;
    name?: string;
    models?: Record<string, { name?: string; variants?: Record<string, unknown> }>;
  }>;
  connected?: string[];
  default?: Record<string, string>;
};

@Injectable()
export class OpenCodeClient {
  private readonly sessionIdsByDirectory = new Map<string, string>();
  private cachedDefaultModel: { providerID: string; modelID: string } | null = null;
  private cachedProvidersResponse: OpenCodeProvidersResponse | null = null;

  public constructor(@Inject(ConfigToken) private readonly config: AppConfig) {}

  public async sendPrompt(
    prompt: string,
    input: {
      directory: string;
      model?: OpenCodeExecutionModel;
      agent?: string | null;
      onSessionResolved?: (sessionID: string) => void;
    }
  ): Promise<PromptResult> {
    /* Ensure a session exists for the target directory. */
    const sessionId = await this.ensureSession(input.directory);
    input.onSessionResolved?.(sessionId);

    /*
     * Use the synchronous message endpoint.
     * This returns assistant parts in the HTTP response and works reliably
     * without additional polling.
     */
    const model = input.model ?? (await this.getDefaultModel());
    const agent = input.agent ?? "build";

    const response = await this.request<OpenCodeMessageResponse>(
      `/session/${sessionId}/message?directory=${encodeURIComponent(input.directory)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parts: [{ type: "text", text: prompt }],
          model,
          agent
        })
      }
    );

    const responseText = this.extractText(response);
    return {
      sessionId,
      responseText,
      info: {
        providerID: response.info.providerID,
        modelID: response.info.modelID,
        mode: response.info.mode,
        agent: response.info.agent,
        tokens: response.info.tokens
      },
      parts: (response.parts ?? []) as any
    };
  }

  public async listCommands(input?: { directory?: string }): Promise<OpenCodeCommand[]> {
    /*
     * Return available slash commands.
     * If directory is provided, we pass it to OpenCode to include project-local commands.
     */
    const query = input?.directory
      ? `?directory=${encodeURIComponent(input.directory)}`
      : "";
    const response = await this.request<OpenCodeCommand[]>(`/command${query}`, {
      method: "GET"
    });

    return Array.isArray(response)
      ? response
          .filter((item) => item && typeof item.name === "string")
          .map((item) => ({ name: item.name, description: item.description }))
      : [];
  }

  public async executeCommand(
    input: { command: string; arguments: string[] },
    context: { directory: string; onSessionResolved?: (sessionID: string) => void }
  ): Promise<PromptResult> {
    /*
     * Execute slash command in the same per-directory session map used by prompts.
     * This keeps command history and prompts in a single OpenCode conversation.
     */
    const sessionId = await this.ensureSession(context.directory);
    context.onSessionResolved?.(sessionId);
    const response = await this.request<OpenCodeMessageResponse>(
      `/session/${sessionId}/command?directory=${encodeURIComponent(context.directory)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: input.command,
          arguments: input.arguments
        })
      }
    );

    const responseText = this.extractText(response);
    return {
      sessionId,
      responseText,
      info: {
        providerID: response.info.providerID,
        modelID: response.info.modelID,
        mode: response.info.mode,
        agent: response.info.agent,
        tokens: response.info.tokens
      },
      parts: (response.parts ?? []) as any
    };
  }

  public async getModelContextLimit(input: {
    providerID: string;
    modelID: string;
  }): Promise<{ context: number } | null> {
    /* Resolve model context limit from /provider; cached for low overhead. */
    const providers = await this.getProvidersResponse();
    const provider = providers.all?.find((p) => p?.id === input.providerID);
    const model = provider?.models?.[input.modelID] as any;
    const context = Number(model?.limit?.context);
    if (!Number.isFinite(context) || context <= 0) {
      return null;
    }
    return { context };
  }

  public async getModelDisplayName(input: {
    providerID: string;
    modelID: string;
  }): Promise<{ providerName: string; modelName: string } | null> {
    /* Best-effort display names for UI/Telegram. */
    const providers = await this.getProvidersResponse();
    const provider = providers.all?.find((p) => p?.id === input.providerID);
    const model = provider?.models?.[input.modelID];
    const providerName = String(provider?.name ?? "").trim();
    const modelName = String(model?.name ?? "").trim();
    if (!providerName && !modelName) {
      return null;
    }
    return { providerName: providerName || input.providerID, modelName: modelName || input.modelID };
  }

  public async listProviders(): Promise<OpenCodeProviderSummary[]> {
    /* Return compact provider list used by Telegram selector. */
    const response = await this.getProvidersResponse();
    const connected = new Set(Array.isArray(response.connected) ? response.connected : []);
    const defaults = response.default ?? {};

    return (response.all ?? [])
      .filter((item) => typeof item.id === "string")
      .map((item) => ({
        id: String(item.id),
        name: String(item.name ?? item.id),
        connected: connected.has(String(item.id)),
        defaultModelID: defaults[String(item.id)]
      }))
      .sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
  }

  public async listModels(providerID: string): Promise<OpenCodeProviderModel[]> {
    /* Return provider model list with available thinking variants. */
    const response = await this.getProvidersResponse();
    const provider = response.all?.find((item) => item.id === providerID);
    if (!provider) {
      throw new Error(`Unknown provider: ${providerID}`);
    }

    return Object.entries(provider.models ?? {})
      .map(([id, model]) => ({
        id,
        name: String(model?.name ?? id),
        variants: Object.keys(model?.variants ?? {})
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  public async listAgents(): Promise<OpenCodeAgent[]> {
    /* Return available agents for Telegram picker. */
    const response = await this.request<Array<{ name?: string; description?: string; mode?: string }>>(
      "/agent",
      { method: "GET" }
    );

    return Array.isArray(response)
      ? response
          .filter((item) => typeof item?.name === "string")
          .map((item) => ({
            name: String(item.name),
            description: item.description,
            mode: item.mode
          }))
      : [];
  }

  public async listQuestions(input: { directory: string }): Promise<
    Array<{
      id: string;
      sessionID: string;
      questions: Array<{
        header: string;
        question: string;
        options: Array<{ label: string; description: string }>;
        multiple?: boolean;
      }>;
    }>
  > {
    /* Return pending question tool requests for a session directory. */
    const response = await this.request<Array<any>>(`/question?directory=${encodeURIComponent(input.directory)}`, {
      method: "GET"
    });

    return Array.isArray(response)
      ? response
          .filter((item) => item && typeof item.id === "string" && typeof item.sessionID === "string")
          .map((item) => ({
            id: String(item.id),
            sessionID: String(item.sessionID),
            questions: Array.isArray(item.questions)
              ? item.questions
                  .filter((q: any) => q && typeof q.question === "string")
                  .map((q: any) => ({
                    header: String(q.header ?? "Question"),
                    question: String(q.question),
                    options: Array.isArray(q.options)
                      ? q.options
                          .filter((o: any) => o && typeof o.label === "string")
                          .map((o: any) => ({ label: String(o.label), description: String(o.description ?? "") }))
                      : [],
                    multiple: Boolean(q.multiple)
                  }))
              : []
          }))
      : [];
  }

  public async replyQuestion(input: {
    directory: string;
    requestID: string;
    answers: string[][];
  }): Promise<void> {
    /* Submit answers for a pending question tool request. */
    await this.request<unknown>(
      `/question/${encodeURIComponent(input.requestID)}/reply?directory=${encodeURIComponent(input.directory)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: input.answers })
      }
    );
  }

  public async getDefaultModel(): Promise<{ providerID: string; modelID: string }> {
    /*
     * Resolve OpenCode default model.
     * We prefer an explicit env override, otherwise we ask OpenCode.
     */
    if (this.config.opencodeDefaultProviderId && this.config.opencodeDefaultModelId) {
      return {
        providerID: this.config.opencodeDefaultProviderId,
        modelID: this.config.opencodeDefaultModelId
      };
    }

    if (this.cachedDefaultModel) {
      return this.cachedDefaultModel;
    }

    const config = await this.request<OpenCodeProvidersConfig>("/config/providers", {
      method: "GET"
    });

    const entries = Object.entries(config?.default ?? {});
    if (entries.length === 0) {
      throw new Error(
        "OpenCode default model is not configured. Set OPENCODE_DEFAULT_PROVIDER_ID and OPENCODE_DEFAULT_MODEL_ID"
      );
    }

    const [providerID, modelID] = entries[0];
    this.cachedDefaultModel = { providerID, modelID };
    return this.cachedDefaultModel;
  }

  private async getProvidersResponse(): Promise<OpenCodeProvidersResponse> {
    /* Cache /provider payload; it is large and mostly static at runtime. */
    if (this.cachedProvidersResponse) {
      return this.cachedProvidersResponse;
    }

    const response = await this.request<OpenCodeProvidersResponse>("/provider", { method: "GET" });
    this.cachedProvidersResponse = response ?? { all: [], connected: [], default: {} };
    return this.cachedProvidersResponse;
  }

  private async ensureSession(directory: string): Promise<string> {
    /*
     * Reuse a per-directory session.
     * This is critical: OpenCode uses session directory as the workspace root.
     */
    const existing = this.sessionIdsByDirectory.get(directory);
    if (existing) {
      return existing;
    }

    /* Create a new session scoped to the directory. */
    const response = await this.request<{ id?: string }>(
      `/session?directory=${encodeURIComponent(directory)}`,
      {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
      }
    );

    if (!response.id) {
      throw new Error("OpenCode session id missing in response");
    }

    this.sessionIdsByDirectory.set(directory, response.id);
    return response.id;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    /* Build request with optional basic auth. */
    const url = `${this.config.opencodeServerUrl}${path}`;
    const headers = new Headers(init.headers);

    if (this.config.opencodeServerPassword && this.config.opencodeServerUsername) {
      const credentials = `${this.config.opencodeServerUsername}:${this.config.opencodeServerPassword}`;
      const encoded = Buffer.from(credentials).toString("base64");
      headers.set("Authorization", `Basic ${encoded}`);
    }

    const response = await fetch(url, { ...init, headers });

    if (!response.ok) {
      throw new Error(`OpenCode request failed: ${response.status}`);
    }

    /* Some OpenCode endpoints may respond with 204 or empty body. */
    const text = await response.text();
    if (!text) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }

  private extractText(response: OpenCodeMessageResponse): string {
    /* Concatenate text parts for chat output. */
    const parts = response.parts ?? [];
    return parts
      .filter((part: any) => part?.type === "text")
      .map((part: any) => String(part?.text ?? ""))
      .join("");
  }
}
