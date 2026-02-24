/**
 * @fileoverview OpenCode HTTP client for sessions and prompts.
 *
 * Exports:
 * - PromptResult (L30) - Prompt response shape.
 * - OpenCodeClient (L57) - Sends prompts and manages sessions.
 */

import { Inject, Injectable } from "@nestjs/common";
import { AppConfig, ConfigToken } from "../config/config.types";
import {
  createSessionViaApi,
  isSessionBusyViaApi,
  listSessionsViaApi,
  OpenCodeSessionSummary,
  selectSessionViaApi
} from "./opencode-session-state";
import { formatOpenCodeHttpError } from "./opencode-http-error";
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
import { isBusySessionStale } from "./opencode-session-repair";

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
    /* Use synchronous message endpoint to get parts in one HTTP response. */
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
    /* Include directory when set to expose project-local slash commands. */
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
    /* Use same directory session map as prompts to keep one conversation history. */
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

  public async replyPermission(input: {
    directory: string;
    sessionID: string;
    permissionID: string;
    response: "once" | "always" | "reject";
  }): Promise<void> {
    /* Submit answer for a pending permission prompt in a session. */
    await this.request<unknown>(
      `/session/${encodeURIComponent(input.sessionID)}/permissions/${encodeURIComponent(input.permissionID)}?directory=${encodeURIComponent(input.directory)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: input.response })
      }
    );
  }

  public async repairStuckSessions(input: {
    directory: string;
    busyTimeoutMs: number;
  }): Promise<{ scanned: number; busy: number; aborted: string[] }> {
    /* Read current session statuses from OpenCode for the selected project root. */
    const statuses = await this.request<Record<string, { type?: string; updatedAt?: string | number }>>(
      `/session/status?directory=${encodeURIComponent(input.directory)}`,
      { method: "GET" }
    );

    /* Keep counters explicit for Telegram /repair summary output. */
    const ids = Object.keys(statuses ?? {});
    const busyIds = ids.filter((sessionID) => {
      const status = statuses?.[sessionID];
      if (status?.type !== "busy") {
        return false;
      }

      return isBusySessionStale(status.updatedAt, input.busyTimeoutMs);
    });

    /* Abort only stale busy sessions so active runs are not interrupted. */
    const aborted: string[] = [];
    for (const sessionID of busyIds) {
      await this.request<boolean>(
        `/session/${encodeURIComponent(sessionID)}/abort?directory=${encodeURIComponent(input.directory)}`,
        { method: "POST" }
      );
      aborted.push(sessionID);
    }

    /* Remove stale cached mapping when the repaired session matches current directory. */
    const cached = this.sessionIdsByDirectory.get(input.directory);
    if (cached && aborted.includes(cached)) {
      this.sessionIdsByDirectory.delete(input.directory);
    }

    return {
      scanned: ids.length,
      busy: busyIds.length,
      aborted
    };
  }

  public async listSessions(input: { directory: string; limit: number }): Promise<OpenCodeSessionSummary[]> {
    /* Delegate normalization logic to dedicated session-state helper module. */
    return listSessionsViaApi({
      request: (path, init) => this.request(path, init),
      directory: input.directory,
      limit: input.limit
    });
  }

  public async createSession(input: { directory: string }): Promise<{ id: string }> {
    /* Use helper to ensure creation and active-session cache update stay consistent. */
    return createSessionViaApi({
      request: (path, init) => this.request(path, init),
      directory: input.directory,
      sessionIdsByDirectory: this.sessionIdsByDirectory
    });
  }

  public async selectSession(input: { directory: string; sessionID: string; limit?: number }): Promise<void> {
    /* Use helper to validate session ownership and switch active context. */
    await selectSessionViaApi({
      request: (path, init) => this.request(path, init),
      directory: input.directory,
      sessionID: input.sessionID,
      limit: input.limit,
      sessionIdsByDirectory: this.sessionIdsByDirectory
    });
  }

  public getSelectedSessionID(directory: string): string | null {
    /* Expose cached active session id for UI active marker in /sessions list. */
    return this.sessionIdsByDirectory.get(directory) ?? null;
  }

  public async getDefaultModel(): Promise<{ providerID: string; modelID: string }> {
    /* Prefer explicit env override, otherwise resolve default model from OpenCode. */
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
    /* Reuse per-directory session because OpenCode binds workspace to directory. */
    const existing = this.sessionIdsByDirectory.get(directory);
    if (existing) {
      /* Rotate away from stuck busy session to avoid blocking all future prompts. */
      const busy = await this.isSessionBusy(existing, directory);
      if (!busy) {
        return existing;
      }

      await this.request<boolean>(
        `/session/${encodeURIComponent(existing)}/abort?directory=${encodeURIComponent(directory)}`,
        { method: "POST" }
      );
      this.sessionIdsByDirectory.delete(directory);
    }

    /* Create and cache fresh session when no reusable id exists. */
    const created = await this.createSession({ directory });
    return created.id;
  }

  private async isSessionBusy(sessionID: string, directory: string): Promise<boolean> {
    /* Delegate busy-state lookup to session helper to keep client lean. */
    return isSessionBusyViaApi({
      request: (path, init) => this.request(path, init),
      sessionID,
      directory
    });
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
      /* Preserve provider-level failure details (including retry hints) for user feedback. */
      const bodyText = await response.text();
      throw new Error(
        formatOpenCodeHttpError({
          status: response.status,
          bodyText,
          retryAfterHeader: response.headers.get("retry-after")
        })
      );
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
