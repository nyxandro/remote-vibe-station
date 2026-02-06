/**
 * @fileoverview HTTP controller for prompt requests.
 *
 * Exports:
 * - PromptResponse (L16) - Response shape for prompt endpoint.
 * - PromptController (L22) - Controller for prompt routes.
 * - sendPrompt (L27) - Handler for POST /api/prompt.
 */

import { BadRequestException, Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";

import { AdminHeaderGuard } from "../security/admin-header.guard";
import { PromptRequest } from "./prompt.types";
import { PromptService } from "./prompt.service";

type PromptResponse = {
  sessionId: string;
  responseText: string;
};

@Controller("api")
export class PromptController {
  public constructor(private readonly promptService: PromptService) {}

  @UseGuards(AdminHeaderGuard)
  @Post("prompt")
  public async sendPrompt(@Body() body: PromptRequest, @Req() req: Request): Promise<PromptResponse> {
    /* Validate request body. */
    if (!body || typeof body.text !== "string" || body.text.trim().length === 0) {
      throw new BadRequestException("Prompt text is required");
    }

    /* Send prompt through OpenCode. */
    try {
      const adminId = (req as any).authAdminId as number | undefined;
      const result = await this.promptService.sendPrompt(body.text.trim(), adminId);
      return { sessionId: result.sessionId, responseText: result.responseText };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }
}
