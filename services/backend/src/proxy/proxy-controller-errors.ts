/**
 * @fileoverview Structured error helpers for proxy-related controllers.
 *
 * Exports:
 * - requireProxyAdminId - Resolves auth admin id or throws structured unauthorized error.
 * - cliproxyProviderUnsupportedError - Unsupported CLIProxy provider error.
 * - cliproxyCompletionInputRequiredError - Missing OAuth completion payload error.
 * - cliproxyAccountIdRequiredError - Missing account id error.
 * - cliproxyAccountIdInvalidError - Invalid/path-like account id error.
 * - proxyModeInvalidError - Unsupported proxy mode error.
 * - proxyVlessUrlRequiredError - Missing vless URL error.
 * - proxyTestUrlRequiredError - Missing VLESS config URL for test/save in vless mode.
 * - proxyEnabledServicesRequiredError - Missing runtime target services.
 */

import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";

import { createAppErrorBody } from "../logging/app-error";

export const requireProxyAdminId = (req: Request): number => {
  /* Proxy management endpoints stay admin-only because they mutate runtime auth and network settings. */
  const adminId = (req as any).authAdminId as number | undefined;
  if (adminId == null) {
    throw new UnauthorizedException(
      createAppErrorBody({
        code: "APP_PROXY_ADMIN_REQUIRED",
        message: "Admin identity is required for proxy management endpoint.",
        hint: "Authenticate as an allowed admin before calling proxy settings endpoints."
      })
    );
  }

  return adminId;
};

export const cliproxyProviderUnsupportedError = (): BadRequestException => {
  /* OAuth onboarding only supports the provider ids known by CLIProxy runtime. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_CLIPROXY_PROVIDER_UNSUPPORTED",
      message: "CLIProxy provider is unsupported.",
      hint: "Choose one of the supported CLIProxy providers and retry OAuth start."
    })
  );
};

export const cliproxyCompletionInputRequiredError = (): BadRequestException => {
  /* OAuth completion needs either callbackUrl or explicit state+code/error pair. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_CLIPROXY_COMPLETION_INPUT_REQUIRED",
      message: "Provide callbackUrl or state with code/error.",
      hint: "Paste the OAuth callback URL or provide both state and code/error, then retry completion."
    })
  );
};

export const cliproxyAccountIdRequiredError = (): BadRequestException => {
  /* Account mutations must target one concrete runtime auth identifier. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_CLIPROXY_ACCOUNT_ID_REQUIRED",
      message: "CLIProxy account id is required.",
      hint: "Choose one account from CLIProxy state and retry the account action."
    })
  );
};

export const cliproxyAccountIdInvalidError = (): BadRequestException => {
  /* Path traversal-like values are rejected before they reach file-backed auth runtime. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_CLIPROXY_ACCOUNT_ID_INVALID",
      message: "CLIProxy account id contains forbidden path characters.",
      hint: "Use the exact account id from CLIProxy state and retry the action."
    })
  );
};

export const proxyModeInvalidError = (): BadRequestException => {
  /* Proxy settings support only direct and vless modes at the controller boundary. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_PROXY_MODE_INVALID",
      message: "Proxy mode must be either 'direct' or 'vless'.",
      hint: "Choose one supported proxy mode and retry saving proxy settings."
    })
  );
};

export const proxyVlessUrlRequiredError = (): BadRequestException => {
  /* Vless mode cannot be activated without one concrete upstream proxy URL. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_PROXY_VLESS_URL_REQUIRED",
      message: "vlessProxyUrl is required for vless mode.",
      hint: "Provide a valid socks5/http/https proxy URL and retry saving proxy settings."
    })
  );
};

export const proxyTestUrlRequiredError = (): BadRequestException => {
  /* Pasted VLESS link is required because runtime xray config is derived from it. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_PROXY_VLESS_CONFIG_URL_REQUIRED",
      message: "vlessConfigUrl is required for vless mode.",
      hint: "Paste the full VLESS config URL and retry the test or save action."
    })
  );
};

export const proxyEnabledServicesRequiredError = (): BadRequestException => {
  /* Runtime override must know at least one concrete target service to wire through the proxy. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_PROXY_ENABLED_SERVICES_REQUIRED",
      message: "enabledServices must include at least one runtime service.",
      hint: "Choose one or more services that should use the VLESS config and retry saving proxy settings."
    })
  );
};
