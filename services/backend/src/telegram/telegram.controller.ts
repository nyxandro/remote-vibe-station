/**
 * @fileoverview Telegram-related control endpoints.
 *
 * Exports:
 * - TelegramController (L20) - Endpoints used by the bot and miniapp.
 */

import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { EventsService } from "../events/events.service";
import { OpenCodeClient } from "../open-code/opencode-client";
import { OpenCodeSessionRoutingStore } from "../open-code/opencode-session-routing.store";
import { PromptService } from "../prompt/prompt.service";
import { ProjectGitService } from "../projects/project-git.service";
import { ProjectsService } from "../projects/projects.service";
import { AdminHeaderGuard } from "../security/admin-header.guard";
import { AppAuthGuard } from "../security/app-auth.guard";
import { TelegramDiffPreviewStore } from "./diff-preview/telegram-diff-preview.store";
import { TelegramCommandCatalogService } from "./telegram-command-catalog.service";
import { TelegramPreferencesService } from "./preferences/telegram-preferences.service";
import { TelegramStreamStore } from "./telegram-stream.store";

@Controller("api/telegram")
export class TelegramController {
  public constructor(
    private readonly store: TelegramStreamStore,
    private readonly events: EventsService,
    private readonly prompts: PromptService,
    private readonly commandCatalog: TelegramCommandCatalogService,
    private readonly preferences: TelegramPreferencesService,
    private readonly projects: ProjectsService,
    private readonly gitSummary: ProjectGitService,
    private readonly opencode: OpenCodeClient,
    private readonly sessionRouting: OpenCodeSessionRoutingStore,
    private readonly diffPreviews: TelegramDiffPreviewStore
  ) {}

  @UseGuards(AdminHeaderGuard)
  @Get("startup-summary")
  public async getStartupSummary(@Req() req: Request) {
    /* Return all blocks required for informative /start message in bot. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    const [project, settings, catalog] = await Promise.all([
      this.projects.getActiveProject(adminId),
      this.preferences.getSettings(adminId),
      this.commandCatalog.listForAdmin(adminId)
    ]);

    /* Git summary is project-scoped; without project we return explicit null. */
    const git = project ? await this.gitSummary.summaryForProjectRoot(project.rootPath) : null;

    return {
      project: project
        ? {
            slug: project.slug,
            rootPath: project.rootPath
          }
        : null,
      git,
      mode: {
        providerID: settings.selected.model.providerID,
        modelID: settings.selected.model.modelID,
        thinking: settings.selected.thinking,
        agent: settings.selected.agent
      },
      commands: catalog.commands
    };
  }

  @UseGuards(AdminHeaderGuard)
  @Get("settings")
  public async getSettings(@Req() req: Request) {
    /* Return model/agent/thinking settings and options for Telegram mode menu. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    return this.preferences.getSettings(adminId);
  }

  @UseGuards(AdminHeaderGuard)
  @Get("voice-control/admin")
  public getVoiceControlSettingsForAdmin(@Req() req: Request) {
    /* Bot reads voice config using x-admin-id because it does not send initData token. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    return this.preferences.getVoiceControlSettings(adminId);
  }

  @UseGuards(AppAuthGuard)
  @Get("voice-control")
  public getVoiceControlSettings(@Req() req: Request) {
    /* Mini App reads the same settings via Telegram initData/web token auth. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    return this.preferences.getVoiceControlSettings(adminId);
  }

  @UseGuards(AppAuthGuard)
  @Post("voice-control")
  public updateVoiceControlSettings(
    @Body() body: { apiKey?: string | null; model?: string | null },
    @Req() req: Request
  ) {
    /* Mini App persists Groq key/model as-is for Telegram voice-to-text flow. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    try {
      return this.preferences.updateVoiceControlSettings(adminId, body ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }

  @UseGuards(AdminHeaderGuard)
  @Get("settings/models")
  public async getProviderModels(
    @Req() req: Request,
    @Query("providerID") providerIDRaw?: string
  ) {
    /* Return model list for provider switch screen. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    const providerID = String(providerIDRaw ?? "").trim();
    if (!providerID) {
      throw new BadRequestException("providerID is required");
    }

    try {
      return { models: await this.preferences.listModels(providerID) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }

  @UseGuards(AdminHeaderGuard)
  @Post("settings")
  public async updateSettings(
    @Body()
    body: {
      providerID?: string;
      modelID?: string;
      thinking?: string | null;
      agent?: string | null;
    },
    @Req() req: Request
  ) {
    /* Update model/agent/thinking from Telegram mode picker actions. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    try {
      return await this.preferences.updateSettings(adminId, body ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }

  @UseGuards(AdminHeaderGuard)
  @Get("commands")
  public async listCommands(@Req() req: Request) {
    /* Return merged Telegram command catalog (menu + alias lookup) for bot sync. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    return this.commandCatalog.listForAdmin(adminId);
  }

  @UseGuards(AdminHeaderGuard)
  @Post("command")
  public async runCommand(
    @Body() body: { command?: string; arguments?: string[] },
    @Req() req: Request
  ) {
    /* Execute OpenCode slash command in active project context. */
    if (!body || typeof body.command !== "string" || body.command.trim().length === 0) {
      throw new BadRequestException("command is required");
    }

    const command = body.command.trim();
    const args = Array.isArray(body.arguments)
      ? body.arguments.filter((item) => typeof item === "string")
      : [];
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    try {
      const result = await this.prompts.executeCommand({ command, arguments: args }, adminId);
      return { sessionId: result.sessionId, responseText: result.responseText };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }

  @UseGuards(AdminHeaderGuard)
  @Post("question/reply")
  public async replyQuestion(
    @Body() body: { questionToken?: string; optionIndex?: number },
    @Req() req: Request
  ) {
    /* Reply to pending OpenCode question from Telegram inline keyboard callback. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    const questionToken = String(body?.questionToken ?? "").trim();
    const optionIndex = Number(body?.optionIndex);
    if (!questionToken || !Number.isInteger(optionIndex) || optionIndex < 0) {
      throw new BadRequestException("questionToken and optionIndex are required");
    }

    const requestID = this.sessionRouting.resolveQuestionToken(questionToken);
    if (!requestID) {
      throw new BadRequestException("Question token not found");
    }

    const route = this.sessionRouting.resolveQuestion(requestID);
    if (!route || route.adminId !== adminId) {
      throw new BadRequestException("Question request not found");
    }

    const selected = route.options[optionIndex];
    if (!selected) {
      throw new BadRequestException("Invalid option index");
    }

    const questions = await this.opencode.listQuestions({ directory: route.directory });
    const request = questions.find((item) => item.id === requestID);
    if (!request) {
      this.sessionRouting.consumeQuestion(requestID);
      throw new BadRequestException("Question is no longer pending");
    }

    const answers = request.questions.map((_, index) => (index === 0 ? [selected] : []));
    await this.opencode.replyQuestion({
      directory: route.directory,
      requestID,
      answers
    });

    this.sessionRouting.consumeQuestion(requestID);
    return { ok: true, selected };
  }

  @UseGuards(AdminHeaderGuard)
  @Post("bind")
  public bind(@Body() body: { adminId?: number; chatId?: number }) {
    /*
     * Bot calls this to bind adminId -> last chatId.
     * We accept adminId in body to keep bot implementation explicit.
     */
    if (!body || typeof body.adminId !== "number" || typeof body.chatId !== "number") {
      throw new BadRequestException("adminId and chatId are required");
    }

    return this.store.bindAdminChat(body.adminId, body.chatId);
  }

  @UseGuards(AdminHeaderGuard)
  @Post("stream/on")
  public streamOn(@Body() body: { adminId?: number; chatId?: number }) {
    /* Bot calls this to enable stream for a chat. */
    if (!body || typeof body.adminId !== "number" || typeof body.chatId !== "number") {
      throw new BadRequestException("adminId and chatId are required");
    }

    this.store.bindAdminChat(body.adminId, body.chatId);
    const record = this.store.setStreamEnabled(body.adminId, true);

    this.events.publish({
      type: "telegram.stream",
      ts: new Date().toISOString(),
      data: { chatId: record.chatId, enabled: true }
    });

    return record;
  }

  @UseGuards(AdminHeaderGuard)
  @Post("stream/off")
  public streamOff(@Body() body: { adminId?: number; chatId?: number }) {
    /* Bot calls this to disable stream for a chat. */
    if (!body || typeof body.adminId !== "number" || typeof body.chatId !== "number") {
      throw new BadRequestException("adminId and chatId are required");
    }

    this.store.bindAdminChat(body.adminId, body.chatId);
    const record = this.store.setStreamEnabled(body.adminId, false);

    this.events.publish({
      type: "telegram.stream",
      ts: new Date().toISOString(),
      data: { chatId: record.chatId, enabled: false }
    });

    return record;
  }

  @UseGuards(AppAuthGuard)
  @Post("stream/start")
  public startStream(@Req() req: Request) {
    /*
     * Miniapp calls this from within Telegram.
     * Guard validates initData; we derive admin id from it.
     */
    /*
     * In dev mode the guard allows missing initData.
     * We cannot reliably map to a Telegram admin without initData,
     * so we fail fast here.
     */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }
    let record;
    try {
      record = this.store.setStreamEnabled(adminId, true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to enable stream";
      throw new BadRequestException(message);
    }

    this.events.publish({
      type: "telegram.stream",
      ts: new Date().toISOString(),
      data: { chatId: record.chatId, enabled: true }
    });

    return record;
  }

  @UseGuards(AppAuthGuard)
  @Post("stream/stop")
  public stopStream(@Req() req: Request) {
    /* Disable Telegram stream from miniapp. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }
    let record;
    try {
      record = this.store.setStreamEnabled(adminId, false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to disable stream";
      throw new BadRequestException(message);
    }

    this.events.publish({
      type: "telegram.stream",
      ts: new Date().toISOString(),
      data: { chatId: record.chatId, enabled: false }
    });

    return record;
  }

  @UseGuards(AppAuthGuard)
  @Get("stream/status")
  public streamStatus(@Req() req: Request) {
    /* Return current stream setting for the Telegram user. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    return this.store.get(adminId);
  }

  @UseGuards(AppAuthGuard)
  @Get("diff-preview/:token")
  public getDiffPreview(@Param("token") token: string, @Req() req: Request) {
    /* Return a stored file diff preview for Mini App deep-link token. */
    const adminId = (req as any).authAdminId as number | undefined;
    if (!adminId) {
      throw new BadRequestException("Admin identity missing");
    }

    const normalizedToken = String(token ?? "").trim();
    if (!normalizedToken) {
      throw new BadRequestException("token is required");
    }

    const preview = this.diffPreviews.get(normalizedToken);
    if (!preview || preview.adminId !== adminId) {
      throw new BadRequestException("Diff preview not found");
    }

    return {
      token: preview.token,
      operation: preview.operation,
      absolutePath: preview.absolutePath,
      additions: preview.additions,
      deletions: preview.deletions,
      diff: preview.diff,
      before: preview.before ?? null,
      after: preview.after ?? null,
      createdAt: preview.createdAt
    };
  }
}
