/**
 * @fileoverview Global exception filter for structured error logging.
 *
 * Exports:
 * - REQUEST_ID_HEADER (L12) - Header name for request id.
 * - AllExceptionsFilter (L15) - Logs errors with request context.
 */

import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import { Request, Response } from "express";

import { resolveExceptionAppError } from "./app-error";
import { REQUEST_ID_HEADER } from "./request-id.middleware";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    /* Build structured log entry with request context. */
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const requestId = request.headers[REQUEST_ID_HEADER];
    const appError = resolveExceptionAppError({ exception, statusCode: status });

    const errorPayload = {
      level: "error",
      status,
      requestId,
      code: appError.code,
      message: appError.message,
      hint: appError.hint,
      method: request.method,
      path: request.url,
      errorName: exception instanceof Error ? exception.name : null,
      stack: exception instanceof Error ? exception.stack : null
    };

    console.error(JSON.stringify(errorPayload));

    /*
     * Never throw from the filter itself.
     * We also guard against double writes on edge cases.
     */
    if (response.headersSent) {
      return;
    }

    response.status(status).json({ statusCode: status, ...appError, requestId });
  }
}
