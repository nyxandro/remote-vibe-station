/**
 * @fileoverview NestJS module for validated configuration.
 *
 * Exports:
 * - ConfigModule (L25) - Provides AppConfig via DI token.
 */

import { Module } from "@nestjs/common";

import { loadConfig } from "./config";
import { ConfigToken } from "./config.types";

@Module({
  providers: [
    {
      provide: ConfigToken,
      useFactory: () => {
        /* Load and validate configuration once at startup. */
        return loadConfig();
      }
    }
  ],
  exports: [ConfigToken]
})
export class ConfigModule {}
