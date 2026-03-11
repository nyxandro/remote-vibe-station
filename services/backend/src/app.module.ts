/**
 * @fileoverview Root NestJS module wiring controllers and services.
 *
 * Exports:
 * - AppModule (L56) - Application module definition.
 */

import { Module } from "@nestjs/common";

import { ConfigModule } from "./config/config.module";
import { EventsGateway } from "./events/events.gateway";
import { EventsService } from "./events/events.service";
import { OpenCodeClient } from "./open-code/opencode-client";
import { OpenCodeEventsService } from "./open-code/opencode-events.service";
import { OpenCodeProviderAuthClient } from "./open-code/opencode-provider-auth.client";
import { OpenCodeSessionRoutingStore } from "./open-code/opencode-session-routing.store";
import { OpenCodeWebLinkService } from "./open-code/opencode-web-link.service";
import { OpenCodeController } from "./opencode-admin/opencode.controller";
import { OpenCodeProjectSyncService } from "./opencode-admin/opencode-project-sync.service";
import { OpenCodeSettingsService } from "./opencode-admin/opencode-settings.service";
import { OpenCodeRuntimeService } from "./opencode-admin/opencode-runtime.service";
import { TelegramController } from "./telegram/telegram.controller";
import { TelegramProviderController } from "./telegram/telegram-provider.controller";
import { TelegramSessionController } from "./telegram/telegram-session.controller";
import { TelegramCommandCatalogService } from "./telegram/telegram-command-catalog.service";
import { TelegramStreamStore } from "./telegram/telegram-stream.store";
import { TelegramPreferencesService } from "./telegram/preferences/telegram-preferences.service";
import { TelegramPreferencesStore } from "./telegram/preferences/telegram-preferences.store";
import { TelegramOutboxController } from "./telegram/outbox/telegram-outbox.controller";
import { TelegramOutboxStore } from "./telegram/outbox/telegram-outbox.store";
import { TelegramOutboxService } from "./telegram/outbox/telegram-outbox.service";
import { TelegramEventsOutboxBridge } from "./telegram/outbox/telegram-events-outbox-bridge.service";
import { TelegramOpenCodeRuntimeBridge } from "./telegram/outbox/telegram-opencode-runtime-bridge.service";
import { TelegramDiffPreviewStore } from "./telegram/diff-preview/telegram-diff-preview.store";
import { TelegramPromptAttachmentsService } from "./telegram/prompt-queue/telegram-prompt-attachments.service";
import { TelegramPromptQueueService } from "./telegram/prompt-queue/telegram-prompt-queue.service";
import { TelegramPromptQueueStore } from "./telegram/prompt-queue/telegram-prompt-queue.store";
import { PromptController } from "./prompt/prompt.controller";
import { PromptService } from "./prompt/prompt.service";
import { ProjectsController } from "./projects/projects.controller";
import { ProjectFilesController } from "./projects/project-files.controller";
import { ProjectsAdminController } from "./projects/projects-admin.controller";
import { ProjectsService } from "./projects/projects.service";
import { ProjectRegistry } from "./projects/project-registry";
import { DockerComposeService } from "./projects/docker-compose.service";
import { ProjectStateStore } from "./projects/project-state.store";
import { ActiveProjectStore } from "./projects/active-project.store";
import { ProjectFilesService } from "./projects/project-files.service";
import { ProjectTerminalService } from "./projects/project-terminal.service";
import { ProjectGitService } from "./projects/project-git.service";
import { ProjectGitOpsService } from "./projects/project-git-ops.service";
import { ProjectWorkspaceService } from "./projects/project-workspace.service";
import { ProjectDeploymentService } from "./projects/project-deployment.service";
import { ProjectRuntimeSettingsStore } from "./projects/project-runtime-settings.store";
import { AdminHeaderGuard } from "./security/admin-header.guard";
import { BotBackendGuard } from "./security/bot-backend.guard";
import { AppAuthGuard } from "./security/app-auth.guard";
import { TelegramInitDataGuard } from "./security/telegram.guard";
import { TerminalController } from "./terminal/terminal.controller";
import { TerminalService } from "./terminal/terminal.service";
import { DataMaintenanceService } from "./maintenance/data-maintenance.service";
import { GithubAppService } from "./github/github-app.service";
import { GithubAppStore } from "./github/github-app.store";
import { GithubGitCredentialController } from "./github/github-git-credential.controller";
import { TelegramGithubController } from "./telegram/telegram-github.controller";
import { SystemMetricsController } from "./system/system-metrics.controller";
import { SystemMetricsService } from "./system/system-metrics.service";
import { ProxySettingsController } from "./proxy/proxy-settings.controller";
import { ProxySettingsService } from "./proxy/proxy-settings.service";
import { ProxySettingsStore } from "./proxy/proxy-settings.store";
import { CliproxyAccountController } from "./proxy/cliproxy-account.controller";
import { CliproxyAccountService } from "./proxy/cliproxy-account.service";
import { CliproxyAuthRuntimeService } from "./proxy/cliproxy-auth-runtime.service";
import { CliproxyManagementClient } from "./proxy/cliproxy-management.client";
import { KanbanController } from "./kanban/kanban.controller";
import { KanbanAgentController } from "./kanban/kanban-agent.controller";
import { KanbanService } from "./kanban/kanban.service";
import { KanbanStore } from "./kanban/kanban.store";
import { KanbanAgentGuard } from "./security/kanban-agent.guard";

@Module({
  imports: [ConfigModule],
  controllers: [
    PromptController,
    ProjectsController,
    ProjectFilesController,
    ProjectsAdminController,
    TerminalController,
    OpenCodeController,
    TelegramController,
    TelegramProviderController,
    TelegramGithubController,
    GithubGitCredentialController,
    TelegramSessionController,
    TelegramOutboxController,
    SystemMetricsController,
    ProxySettingsController,
    CliproxyAccountController,
    KanbanController,
    KanbanAgentController
  ],
  providers: [
    EventsService,
    EventsGateway,
    OpenCodeClient,
    OpenCodeProviderAuthClient,
    OpenCodeEventsService,
    OpenCodeSessionRoutingStore,
    OpenCodeWebLinkService,
    PromptService,
    ProjectsService,
    ProjectRegistry,
    ProjectStateStore,
    ActiveProjectStore,
    ProjectFilesService,
    ProjectTerminalService,
    ProjectGitService,
    ProjectGitOpsService,
    ProjectWorkspaceService,
    ProjectDeploymentService,
    ProjectRuntimeSettingsStore,
    OpenCodeProjectSyncService,
    OpenCodeSettingsService,
    OpenCodeRuntimeService,
    TelegramStreamStore,
    TelegramCommandCatalogService,
    TelegramPreferencesStore,
    TelegramPreferencesService,
    TelegramOutboxStore,
    TelegramOutboxService,
    TelegramEventsOutboxBridge,
    TelegramOpenCodeRuntimeBridge,
    TelegramDiffPreviewStore,
    TelegramPromptQueueStore,
    TelegramPromptAttachmentsService,
    TelegramPromptQueueService,
    DockerComposeService,
    TerminalService,
    AdminHeaderGuard,
    BotBackendGuard,
    AppAuthGuard,
    TelegramInitDataGuard,
    DataMaintenanceService,
    GithubAppStore,
    GithubAppService,
    SystemMetricsService,
    ProxySettingsStore,
    ProxySettingsService,
    CliproxyManagementClient,
    CliproxyAuthRuntimeService,
    CliproxyAccountService,
    KanbanStore,
    KanbanService,
    KanbanAgentGuard
  ]
})
export class AppModule {}
