/**
 * @fileoverview Global exception filter for structured error logging.
 *
 * Exports:
 * - REQUEST_ID_HEADER (L12) - Header name for request id.
 * - AllExceptionsFilter (L15) - Logs errors with request context.
 */

import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import { Request, Response } from "express";

const REQUEST_ID_HEADER = "x-request-id";

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    /* Build structured log entry with request context. */
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const requestId = request.headers[REQUEST_ID_HEADER];

    const errorPayload = {
      level: "error",
      status,
      requestId,
      method: request.method,
      path: request.url
    };

    console.error(JSON.stringify(errorPayload));

    /*
     * Never throw from the filter itself.
     * We also guard against double writes on edge cases.
     */
    if (response.headersSent) {
      return;
    }

    /* Prefer HttpException response body over generic message. */
    const message =
      exception instanceof HttpException
        ? (() => {
            const body = exception.getResponse() as any;
            if (typeof body === "string") {
              return body;
            }
            if (body && typeof body === "object" && typeof body.message === "string") {
              return body.message;
            }
            return exception.message;
          })()
        : exception instanceof Error
          ? exception.message
          : "Internal Server Error";

    response.status(status).json({ statusCode: status, message, requestId });
  }
}
