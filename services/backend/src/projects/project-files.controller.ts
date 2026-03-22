/**
 * @fileoverview HTTP controller for project-scoped file upload, URL import, and download actions.
 *
 * Exports:
 * - ProjectFilesController - Handles upload/import/download endpoints for the Mini App file manager.
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";

import { AppAuthGuard } from "../security/app-auth.guard";
import { EventsService } from "../events/events.service";
import { publishWorkspaceStateChangedEvent } from "../events/workspace-events";
import { ProjectFilesService, PROJECT_FILE_UPLOAD_LIMIT_BYTES } from "./project-files.service";
import { ProjectsService } from "./projects.service";

type UploadedProjectFile = {
  originalname: string;
  buffer: Buffer;
  size: number;
};

@Controller("api/projects/:id")
@UseGuards(AppAuthGuard)
export class ProjectFilesController {
  public constructor(
    private readonly projects: ProjectsService,
    private readonly files: ProjectFilesService,
    private readonly events: EventsService
  ) {}

  @Post("files/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: PROJECT_FILE_UPLOAD_LIMIT_BYTES } }))
  public async uploadFromDevice(
    @Param("id") id: string,
    @Body() body: { path?: string },
    @UploadedFile() file?: UploadedProjectFile
  ) {
    /* Device uploads require a multipart file payload and target the currently opened project folder. */
    if (!file?.originalname || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException("Multipart file is required");
    }

    const projectRootPath = this.projects.getProjectRootPath(id);
    const result = await this.files.writeUploadedFile(projectRootPath, body?.path, {
      fileName: file.originalname,
      content: file.buffer
    });
    publishWorkspaceStateChangedEvent({ events: this.events, projectSlug: id, surfaces: ["files", "git", "projects"], reason: "files.upload" });
    return result;
  }

  @Post("files/import-url")
  public async importFromUrl(
    @Param("id") id: string,
    @Body() body: { path?: string; url?: string }
  ) {
    /* URL imports fail fast unless the request includes an explicit external source. */
    if (!body?.url || typeof body.url !== "string" || body.url.trim().length === 0) {
      throw new BadRequestException("File URL is required");
    }

    const projectRootPath = this.projects.getProjectRootPath(id);
    const result = await this.files.importFileFromUrl(projectRootPath, body?.path, body.url.trim());
    publishWorkspaceStateChangedEvent({ events: this.events, projectSlug: id, surfaces: ["files", "git", "projects"], reason: "files.import-url" });
    return result;
  }

  @Get("files/download")
  public async download(
    @Param("id") id: string,
    @Query("path") relativePath: string | undefined,
    @Res({ passthrough: true }) response: Response
  ) {
    /* Download streams the selected project file as an attachment for browser-side save action. */
    if (!relativePath || relativePath.trim().length === 0) {
      throw new BadRequestException("File path is required");
    }

    const projectRootPath = this.projects.getProjectRootPath(id);
    const result = this.files.readDownloadFile(projectRootPath, relativePath);
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader("Content-Disposition", this.buildAttachmentDisposition(result.fileName));
    return new StreamableFile(result.content);
  }

  private buildAttachmentDisposition(fileName: string): string {
    /* Include UTF-8 filename* so downloads preserve spaces and non-ASCII names across browsers. */
    const sanitized = fileName.replace(/[\\\u0000-\u001f\u007f]+/g, " ").trim() || "download";
    const escaped = sanitized.replace(/"/g, '\\"');
    return `attachment; filename="${escaped}"; filename*=UTF-8''${encodeURIComponent(sanitized)}`;
  }
}
