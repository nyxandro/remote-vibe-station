/**
 * @fileoverview Tests for event-stream token controller validation and error contract.
 */

import { BadRequestException } from "@nestjs/common";

import { EventsController } from "../events.controller";

describe("EventsController", () => {
  it("rejects missing admin identity with structured error payload", () => {
    /* WS token minting must fail fast when HTTP auth did not resolve one admin id. */
    const controller = new EventsController({ issueToken: jest.fn() } as any);

    expect(() => controller.issueToken({ topics: ["kanban"] }, { authAdminId: undefined } as any)).toThrow(
      BadRequestException
    );

    try {
      controller.issueToken({ topics: ["kanban"] }, { authAdminId: undefined } as any);
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: "APP_EVENT_STREAM_ADMIN_REQUIRED",
        message: "Admin identity is required before issuing event token.",
        hint: "Authenticate through Telegram initData or browser token and retry."
      });
    }
  });

  it("rejects terminal subscriptions without project scope using structured error payload", () => {
    /* Terminal event stream must always be scoped to one concrete project. */
    const controller = new EventsController({
      issueToken: jest.fn(() => {
        throw new Error("projectSlug is required for terminal topic");
      })
    } as any);

    expect(() => controller.issueToken({ topics: ["terminal"] }, { authAdminId: 42 } as any)).toThrow(
      BadRequestException
    );

    try {
      controller.issueToken({ topics: ["terminal"] }, { authAdminId: 42 } as any);
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: "APP_EVENT_STREAM_PROJECT_SCOPE_REQUIRED",
        message: "Terminal subscriptions require project scope.",
        hint: "Select a project slug before opening the terminal event stream."
      });
    }
  });
});
