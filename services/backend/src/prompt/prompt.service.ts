/**
 * @fileoverview Service for handling prompt requests.
 *
 * Exports:
 * - PromptResult (L20) - Result shape for prompt processing.
 * - PromptService (L61) - Sends prompts, commands, recovery, and session actions.
 */

import { Injectable, Optional } from "@nestjs/common";

import { EventsService } from "../events/events.service";
import { OpenCodeFinalMessageService } from "../open-code/opencode-final-message.service";
import { OpenCodeCommand, OpenCodeExecutionModel, OpenCodePromptInputPart } from "../open-code/opencode.types";
import { OpenCodeClient, SessionResolution } from "../open-code/opencode-client";
import { OpenCodeEventsService } from "../open-code/opencode-events.service";
import { isOpenCodeFetchTransportFailure, logOpenCodeTransportFailure } from "../open-code/opencode-transport-errors";
import { OpenCodeSessionRoutingStore } from "../open-code/opencode-session-routing.store";
import { ProjectsService } from "../projects/projects.service";
import { TelegramPreferencesService } from "../telegram/preferences/telegram-preferences.service";
import { publishPromptRuntimeTurnStarted } from "./prompt-runtime-turn-event";

const COMMAND_RUNTIME_PROVIDER_ID = "command";
const COMMAND_RUNTIME_MODEL_ID = "command";

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

type RepairResult = {
  projectSlug: string;
  directory: string;
  busyTimeoutMs: number;
  scanned: number;
  busy: number;
  aborted: string[];
};

type SessionListResult = {
  projectSlug: string;
  directory: string;
  sessions: Array<{
    id: string;
    title: string | null;
    status: string;
    updatedAt: string | null;
    active: boolean;
  }>;
};

const ACTIVE_PROJECT_REQUIRED_MESSAGE =
  "Проект не выбран. Выберите его командой /project <slug> (например: /project my-project) или в Mini App.";
const REPAIR_BUSY_TIMEOUT_MS = 45_000;
const RUNTIME_SETTLE_AFTER_FETCH_FAILURE_MS = 30_000;

@Injectable()
export class PromptService {
  private readonly finalMessages: OpenCodeFinalMessageService;

  public constructor(
    private readonly opencode: OpenCodeClient,
    private readonly events: EventsService,
    private readonly projects: ProjectsService,
    private readonly preferences: TelegramPreferencesService,
    private readonly sessionRouting: OpenCodeSessionRoutingStore,
    private readonly opencodeEvents: OpenCodeEventsService,
    @Optional() finalMessages?: OpenCodeFinalMessageService
  ) {
    /* Tests still construct PromptService manually, so fall back to a local shared publisher when DI is absent. */
    this.finalMessages = finalMessages ?? new OpenCodeFinalMessageService(this.opencode, this.events);
  }

  public async sendPrompt(text: string, adminId?: number): Promise<PromptResult> {
    /* Require active project to avoid using OpenCode global workspace. */
    const active = await this.projects.getActiveProject(adminId);
    if (!active) {
      throw new Error(ACTIVE_PROJECT_REQUIRED_MESSAGE);
    }

    return this.dispatchPromptParts({
      adminId,
      projectSlug: active.slug,
      directory: active.rootPath,
      promptTextForTelemetry: text,
      parts: [{ type: "text", text }]
    });
  }

  public async dispatchPromptParts(input: {
    adminId?: number;
    projectSlug: string;
    directory: string;
    promptTextForTelemetry: string;
    parts: OpenCodePromptInputPart[];
    allowEmptyResponse?: boolean;
  }): Promise<PromptResult> {
    /* Emit prompt start event before the actual OpenCode request for observability parity. */
    this.events.publish({
      type: "opencode.prompt",
      ts: new Date().toISOString(),
      data: {
        text: input.promptTextForTelemetry,
        projectSlug: input.projectSlug,
        directory: input.directory,
        adminId: input.adminId ?? null
      }
    });

    /* Resolve per-admin execution preferences (model/thinking/agent). */
    const execution: {
      model: OpenCodeExecutionModel;
      agent: string | null;
    } = input.adminId
      ? await this.preferences.getExecutionSettings(input.adminId)
      : {
          model: { ...(await this.opencode.getDefaultModel()) },
          agent: null
        };

    /* Ensure runtime SSE subscription for the active project directory. */
    this.opencodeEvents.ensureDirectory(input.directory);
    await this.opencodeEvents.waitUntilConnected(input.directory);

    /* Send prompt to OpenCode and gather response. */
    let resolvedSessionID: string | null = null;
    const onSessionResolved = (sessionID: string, sessionResolution: SessionResolution) => {
      resolvedSessionID = sessionID;
      if (input.adminId) {
        this.sessionRouting.bind(sessionID, { adminId: input.adminId, directory: input.directory });
        this.opencodeEvents.watchPermissionOnce({ directory: input.directory, sessionID });
      }
      publishPromptRuntimeTurnStarted(this.events, {
        adminId: input.adminId,
        projectSlug: input.projectSlug,
        directory: input.directory,
        sessionID,
        providerID: execution.model.providerID,
        modelID: execution.model.modelID,
        thinking: execution.model.variant ?? null,
        agent: execution.agent ?? "build"
      });

      /* Notify Telegram when OpenCode had to create a fresh session outside explicit /new flow. */
      this.publishAutoSessionStarted({
        adminId: input.adminId,
        projectSlug: input.projectSlug,
        directory: input.directory,
        sessionID,
        resolution: sessionResolution
      });
    };

    let result: Awaited<ReturnType<OpenCodeClient["sendPromptParts"]>>;
    try {
      result = await this.opencode.sendPromptParts(input.parts, {
        directory: input.directory,
        model: execution.model,
        agent: execution.agent,
        onSessionResolved
      });
    } catch (error) {
      /* Telegram queue prompts may still succeed over SSE after the synchronous HTTP call drops late. */
      if (input.allowEmptyResponse && resolvedSessionID && isOpenCodeFetchTransportFailure(error)) {
        const settled = await this.opencode.waitForSessionToSettle({
          directory: input.directory,
          sessionID: resolvedSessionID,
          timeoutMs: RUNTIME_SETTLE_AFTER_FETCH_FAILURE_MS
        });
        if (settled) {
          return {
            sessionId: resolvedSessionID,
            responseText: "",
            model: {
              providerID: execution.model.providerID,
              modelID: execution.model.modelID
            },
            mode: "primary",
            agent: execution.agent ?? "build",
            tokens: { input: 0, output: 0, reasoning: 0 }
          };
        }
      }

      /* Log one concise transport breadcrumb only when the synchronous call really failed without runtime recovery. */
      if (isOpenCodeFetchTransportFailure(error)) {
        logOpenCodeTransportFailure({
          scope: "prompt.dispatchPromptParts",
          action: input.allowEmptyResponse ? "wait_for_runtime_settle" : "send_prompt_parts",
          directory: input.directory,
          sessionID: resolvedSessionID,
          projectSlug: input.projectSlug,
          adminId: input.adminId ?? null,
          error
        });
      }

      throw error;
    }

    /* Multipart image prompts can finish via runtime stream without immediate HTTP body. */
    if ((result as { emptyResponse?: boolean }).emptyResponse) {
      if (input.allowEmptyResponse) {
        return {
          sessionId: result.sessionId,
          responseText: "",
          model: {
            providerID: result.info.providerID,
            modelID: result.info.modelID
          },
          mode: result.info.mode,
          agent: result.info.agent,
          tokens: { input: 0, output: 0, reasoning: 0 }
        };
      }

      throw new Error("OpenCode returned an empty prompt response");
    }

    return this.publishMessageResult(result, {
      activeProject: { slug: input.projectSlug, rootPath: input.directory },
      adminId: input.adminId,
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
      throw new Error(ACTIVE_PROJECT_REQUIRED_MESSAGE);
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
    await this.opencodeEvents.waitUntilConnected(active.rootPath);

    const result = await this.opencode.executeCommand(input, {
      directory: active.rootPath,
      onSessionResolved: (sessionID, sessionResolution: SessionResolution) => {
        if (adminId) {
          this.sessionRouting.bind(sessionID, { adminId, directory: active.rootPath });
          this.opencodeEvents.watchPermissionOnce({ directory: active.rootPath, sessionID });
        }
        publishPromptRuntimeTurnStarted(this.events, {
          adminId,
          projectSlug: active.slug,
          directory: active.rootPath,
          sessionID,
          providerID: COMMAND_RUNTIME_PROVIDER_ID,
          modelID: COMMAND_RUNTIME_MODEL_ID,
          thinking: null,
          agent: "build"
        });

        /* Command execution must surface the same session reset warning as plain prompts. */
        this.publishAutoSessionStarted({
          adminId,
          projectSlug: active.slug,
          directory: active.rootPath,
          sessionID,
          resolution: sessionResolution
        });
      }
    });
    return this.publishMessageResult(result, {
      activeProject: active,
      adminId,
      thinking: null
    });
  }

  public async repair(adminId?: number): Promise<RepairResult> {
    /* /repair is project-scoped to prevent accidental global session aborts. */
    const active = await this.projects.getActiveProject(adminId);
    if (!active) {
      throw new Error(ACTIVE_PROJECT_REQUIRED_MESSAGE);
    }

    /* Ensure runtime connection is alive before querying/aborting sessions. */
    this.opencodeEvents.ensureDirectory(active.rootPath);
    await this.opencodeEvents.waitUntilConnected(active.rootPath);

    /* Abort stale busy sessions and return machine-readable summary to Telegram. */
    const recovery = await this.opencode.repairStuckSessions({
      directory: active.rootPath,
      busyTimeoutMs: REPAIR_BUSY_TIMEOUT_MS
    });

    return {
      projectSlug: active.slug,
      directory: active.rootPath,
      busyTimeoutMs: REPAIR_BUSY_TIMEOUT_MS,
      scanned: recovery.scanned,
      busy: recovery.busy,
      aborted: recovery.aborted
    };
  }

  public async startNewSession(adminId?: number): Promise<{ projectSlug: string; sessionID: string }> {
    /* /new explicitly rotates chat context to a fresh OpenCode session. */
    const active = await this.projects.getActiveProject(adminId);
    if (!active) {
      throw new Error(ACTIVE_PROJECT_REQUIRED_MESSAGE);
    }

    /* Ensure project event stream is ready before binding route to new session. */
    this.opencodeEvents.ensureDirectory(active.rootPath);
    await this.opencodeEvents.waitUntilConnected(active.rootPath);

    const created = await this.opencode.createSession({ directory: active.rootPath });
    if (adminId) {
      this.sessionRouting.bind(created.id, { adminId, directory: active.rootPath });
      this.opencodeEvents.watchPermissionOnce({ directory: active.rootPath, sessionID: created.id });
    }

    return {
      projectSlug: active.slug,
      sessionID: created.id
    };
  }

  public async listSessions(adminId?: number): Promise<SessionListResult> {
    /* Session picker is always scoped to currently selected project. */
    const active = await this.projects.getActiveProject(adminId);
    if (!active) {
      throw new Error(ACTIVE_PROJECT_REQUIRED_MESSAGE);
    }

    this.opencodeEvents.ensureDirectory(active.rootPath);
    await this.opencodeEvents.waitUntilConnected(active.rootPath);

    const sessions = await this.opencode.listSessions({ directory: active.rootPath, limit: 12 });
    const selectedSessionID = this.opencode.getSelectedSessionID(active.rootPath);

    return {
      projectSlug: active.slug,
      directory: active.rootPath,
      sessions: sessions.map((session) => ({
        ...session,
        active: selectedSessionID === session.id
      }))
    };
  }

  public async selectSession(input: {
    adminId?: number;
    sessionID: string;
  }): Promise<{ projectSlug: string; sessionID: string }> {
    /* Session switch preserves project context while changing conversation thread. */
    const active = await this.projects.getActiveProject(input.adminId);
    if (!active) {
      throw new Error(ACTIVE_PROJECT_REQUIRED_MESSAGE);
    }

    this.opencodeEvents.ensureDirectory(active.rootPath);
    await this.opencodeEvents.waitUntilConnected(active.rootPath);

    await this.opencode.selectSession({
      directory: active.rootPath,
      sessionID: input.sessionID
    });

    if (input.adminId) {
      this.sessionRouting.bind(input.sessionID, { adminId: input.adminId, directory: active.rootPath });
      this.opencodeEvents.watchPermissionOnce({ directory: active.rootPath, sessionID: input.sessionID });
    }

    return {
      projectSlug: active.slug,
      sessionID: input.sessionID
    };
  }

  public async stopActiveSession(adminId?: number): Promise<{
    projectSlug: string;
    sessionID: string;
    aborted: boolean;
  }> {
    /* /stop should interrupt the currently selected session for the active project only. */
    const active = await this.projects.getActiveProject(adminId);
    if (!active) {
      throw new Error(ACTIVE_PROJECT_REQUIRED_MESSAGE);
    }

    /* Keep directory watcher active so session routing remains consistent after the abort. */
    this.opencodeEvents.ensureDirectory(active.rootPath);
    await this.opencodeEvents.waitUntilConnected(active.rootPath);

    const sessionID = this.opencode.getSelectedSessionID(active.rootPath);
    if (!sessionID) {
      throw new Error("Активная сессия не найдена");
    }

    const aborted = await this.opencode.abortSession({
      directory: active.rootPath,
      sessionID
    });

    return {
      projectSlug: active.slug,
      sessionID,
      aborted
    };
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

    /* Shared final publisher keeps prompt and runner flows semantically identical for Telegram consumers. */
    const published = await this.finalMessages.publish({
      sessionId: result.sessionId,
      responseText: result.responseText,
      parts: result.parts,
      info: result.info,
      activeProject: active,
      adminId: context.adminId,
      thinking: context.thinking
    });

    return {
      sessionId: result.sessionId,
      responseText: result.responseText,
      model: {
        providerID: result.info.providerID,
        modelID: result.info.modelID,
        providerName: published.providerName,
        modelName: published.modelName,
        contextLimit: published.contextLimit
      },
      mode: result.info.mode,
      agent: result.info.agent,
      tokens: published.tokens
    };
  }

  private publishAutoSessionStarted(input: {
    adminId?: number;
    projectSlug: string;
    directory: string;
    sessionID: string;
    resolution: SessionResolution;
  }): void {
    /* Emit only for implicit fresh sessions so /new keeps a single direct confirmation from the bot. */
    if (!input.adminId || !input.resolution.isNew) {
      return;
    }

    this.events.publish({
      type: "opencode.session.started",
      ts: new Date().toISOString(),
      data: {
        adminId: input.adminId,
        projectSlug: input.projectSlug,
        directory: input.directory,
        sessionId: input.sessionID,
        trigger: input.resolution.reason
      }
    });
  }
}
