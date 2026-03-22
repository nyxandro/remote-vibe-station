/**
 * @fileoverview Tests for browser web-token refresh controller.
 *
 * Exports:
 * - (none)
 */

import { BadRequestException } from "@nestjs/common";

import { WebTokenController } from "../web-token.controller";
import { verifyWebToken } from "../web-token";

describe("WebTokenController", () => {
  it("issues a browser token for authenticated Telegram Mini App requests", () => {
    /* Telegram initData should bootstrap the same sliding browser token used by long-lived Mini App sessions. */
    const controller = new WebTokenController({ telegramBotToken: "bot-token" } as never);

    const result = controller.bootstrap({
      authAdminId: 649624756,
      headers: { "x-telegram-init-data": "signed-init-data" }
    } as never);

    expect(typeof result.token).toBe("string");
    expect(typeof result.expiresAt).toBe("string");
    expect(verifyWebToken({ token: result.token, botToken: "bot-token" })).toEqual({ adminId: 649624756 });
  });

  it("issues a renewed browser token for authenticated browser requests", () => {
    /* Refresh must mint a fresh signed token for the same admin without exposing raw ids in the response. */
    const controller = new WebTokenController({ telegramBotToken: "bot-token" } as never);

    const result = controller.refresh({
      authAdminId: 649624756,
      headers: { authorization: "Bearer current-token" }
    } as never);

    expect(typeof result.token).toBe("string");
    expect(typeof result.expiresAt).toBe("string");
    expect(verifyWebToken({ token: result.token, botToken: "bot-token" })).toEqual({ adminId: 649624756 });
  });

  it("rejects refresh requests without an existing browser bearer token", () => {
    /* Telegram initData or localhost bypass must not silently mint portable browser tokens. */
    const controller = new WebTokenController({ telegramBotToken: "bot-token" } as never);

    let capturedError: unknown = null;
    try {
      controller.refresh({ authAdminId: 649624756, headers: {} } as never);
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(BadRequestException);
    expect((capturedError as BadRequestException).getResponse()).toMatchObject({
      code: "APP_WEB_TOKEN_REFRESH_AUTH_REQUIRED",
      message: "Browser token refresh requires an existing Bearer token.",
      hint: "Keep the current browser session open, or reopen the Mini App to start a new one."
    });
  });

  it("rejects bootstrap requests outside Telegram Mini App auth flow", () => {
    /* Browser bearer refresh and Telegram initData bootstrap stay intentionally separate to keep auth intent explicit. */
    const controller = new WebTokenController({ telegramBotToken: "bot-token" } as never);

    let capturedError: unknown = null;
    try {
      controller.bootstrap({ authAdminId: 649624756, headers: {} } as never);
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(BadRequestException);
    expect((capturedError as BadRequestException).getResponse()).toMatchObject({
      code: "APP_WEB_TOKEN_BOOTSTRAP_INIT_DATA_REQUIRED",
      message: "Telegram Mini App token bootstrap requires valid initData.",
      hint: "Open the Mini App from Telegram and retry the request."
    });
  });
});
