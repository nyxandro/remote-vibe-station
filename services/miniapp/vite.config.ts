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
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          /* Split editor/highlighter/vendor dependencies so the app shell stops carrying all heavy tooling at startup. */
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (
            id.includes("@uiw/react-codemirror") ||
            id.includes("@uiw/codemirror-") ||
            id.includes("@codemirror/") ||
            id.includes("@lezer/")
          ) {
            return "editor-vendor";
          }

          if (id.includes("shiki")) {
            return "syntax-vendor";
          }

          if (id.includes("lucide-react")) {
            return "icons-vendor";
          }

          if (id.includes("react") || id.includes("scheduler")) {
            return "react-vendor";
          }

          return undefined;
        }
      }
    }
  },
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
