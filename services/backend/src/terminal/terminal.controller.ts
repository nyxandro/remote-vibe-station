/**
 * @fileoverview HTTP controller for terminal input.
 *
 * Exports:
 * - TerminalInput (L15) - Request body for terminal input.
 * - TerminalController (L21) - Controller for terminal routes.
 * - sendInput (L24) - Handler for POST /api/terminal/input.
 */

import { BadRequestException, Body, Controller, Post, UseGuards } from "@nestjs/common";

import { TelegramInitDataGuard } from "../security/telegram.guard";
import { TerminalService } from "./terminal.service";

type TerminalInput = {
  input: string;
};

@Controller("api/terminal")
@UseGuards(TelegramInitDataGuard)
export class TerminalController {
  public constructor(private readonly terminal: TerminalService) {}

  @Post("input")
  public sendInput(@Body() body: TerminalInput) {
    /* Validate input payload. */
    if (!body || typeof body.input !== "string") {
      throw new BadRequestException("Terminal input is required");
    }

    this.terminal.sendInput(body.input);
    return { ok: true };
  }
}
