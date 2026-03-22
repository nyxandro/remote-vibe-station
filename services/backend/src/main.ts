/**
 * @fileoverview Application bootstrap for backend service.
 *
 * Exports:
 * - DEFAULT_PORT (L14) - Default HTTP port.
 * - bootstrap (L16) - Starts NestJS HTTP server.
 */

import { NestFactory } from "@nestjs/core";
import { WsAdapter } from "@nestjs/platform-ws";
import helmet from "helmet";

import { AppModule } from "./app.module";
import { loadConfig } from "./config/config";
import { AllExceptionsFilter } from "./logging/exception.filter";
import { requestIdMiddleware } from "./logging/request-id.middleware";

const DEFAULT_PORT = 3000;
const DEV_ALLOWED_ORIGINS = new Set([
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
]);

const bootstrap = async (): Promise<void> => {
  /* Create and configure NestJS app. */
  const config = loadConfig();
  const isDevelopment = process.env.NODE_ENV === "development";
  const allowedOrigins = new Set<string>(isDevelopment ? DEV_ALLOWED_ORIGINS : []);
  try {
    const publicOrigin = new URL(config.publicBaseUrl).origin;
    allowedOrigins.add(publicOrigin);
  } catch {
    /* Config validation should normally prevent this, but CORS setup still stays fail-closed if URL parsing breaks. */
  }
  const app = await NestFactory.create(AppModule, { cors: false });

  /* Apply baseline HTTP hardening before any routes are exposed. */
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    })
  );
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`APP_CORS_ORIGIN_DENIED: Origin '${origin}' is not allowed for backend access.`), false);
    },
    credentials: true
  });

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
