/**
 * @fileoverview Application bootstrap for backend service.
 *
 * Exports:
 * - DEFAULT_PORT (L14) - Default HTTP port.
 * - bootstrap (L16) - Starts NestJS HTTP server.
 */

import { NestFactory } from "@nestjs/core";
import { WsAdapter } from "@nestjs/platform-ws";

import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./logging/exception.filter";
import { requestIdMiddleware } from "./logging/request-id.middleware";

const DEFAULT_PORT = 3000;

const bootstrap = async (): Promise<void> => {
  /* Create and configure NestJS app. */
  const app = await NestFactory.create(AppModule, { cors: true });

  /*
   * Use the native `ws` adapter for our /events gateway.
   * Default Nest adapter is Socket.IO, which breaks plain WebSocket clients.
   */
  app.useWebSocketAdapter(new WsAdapter(app));

  /* Attach request id middleware and error filter. */
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter());

  /* Start HTTP server on configured port. */
  const port = process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT;
  await app.listen(port);
};

void bootstrap();
