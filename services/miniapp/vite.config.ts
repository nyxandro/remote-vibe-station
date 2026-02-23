/**
 * @fileoverview Vite configuration for Mini App.
 *
 * Exports:
 * - default (L14) - Vite configuration object.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const FALLBACK_BACKEND_URL = "http://localhost:3010";
const backendUrl = process.env.VITE_BACKEND_URL ?? FALLBACK_BACKEND_URL;

export default defineConfig({
  plugins: [react()],
  base: "/miniapp/",
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: backendUrl,
        changeOrigin: true
      },
      "/events": {
        target: backendUrl,
        ws: true,
        changeOrigin: true
      }
    }
  },
  preview: { host: true, port: 4173 }
});
