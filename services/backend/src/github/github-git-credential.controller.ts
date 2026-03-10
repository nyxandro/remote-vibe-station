/**
 * @fileoverview Internal controller that mints short-lived GitHub HTTPS credentials for git helpers.
 *
 * Exports:
 * - GithubGitCredentialController - Handles trusted container requests for GitHub git credential payloads.
 */

import { BadRequestException, Body, Controller, Post, UseGuards } from "@nestjs/common";

import { BotBackendGuard } from "../security/bot-backend.guard";
import { GithubAppService } from "./github-app.service";

type GithubGitCredentialRequest = {
  protocol?: string;
  host?: string;
  path?: string;
};

@Controller("api/internal/github")
export class GithubGitCredentialController {
  public constructor(private readonly github: GithubAppService) {}

  @UseGuards(BotBackendGuard)
  @Post("git-credential")
  public async createCredential(@Body() body: GithubGitCredentialRequest) {
    /* Trusted runtime containers exchange the active GitHub App install for a fresh HTTPS git credential. */
    try {
      return await this.github.createGitCredential(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      throw new BadRequestException(message);
    }
  }
}
