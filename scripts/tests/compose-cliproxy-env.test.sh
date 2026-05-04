#!/usr/bin/env bash
set -euo pipefail

# Backend must receive the same CLIProxy management credentials as the CLIProxy container.
grep -Fq 'CLIPROXY_MANAGEMENT_URL=${CLIPROXY_MANAGEMENT_URL:-http://cliproxy:8317}' docker-compose.yml
grep -Fq 'CLIPROXY_MANAGEMENT_PASSWORD=${CLIPROXY_MANAGEMENT_PASSWORD:?CLIPROXY_MANAGEMENT_PASSWORD must be set}' docker-compose.yml

# Local dev serves Mini App from localhost and needs backend CORS plus deterministic CLIProxy credentials.
grep -Fq 'NODE_ENV=development' docker-compose.dev.yml
grep -Fq 'CLIPROXY_MANAGEMENT_URL=http://cliproxy:8317' docker-compose.dev.yml
grep -Fq 'CLIPROXY_MANAGEMENT_PASSWORD=${CLIPROXY_MANAGEMENT_PASSWORD:-dev-management-password}' docker-compose.dev.yml

# Dev Mini App must run on a Node image, not the production nginx image inherited from the base compose file.
grep -Fq 'dockerfile: Dockerfile.dev' docker-compose.dev.yml
grep -Fq 'entrypoint: []' docker-compose.dev.yml
test -f services/miniapp/Dockerfile.dev

# Vite proxy must preserve the browser localhost Host header for backend dev-only auth bypass.
grep -Fq 'changeOrigin: false' services/miniapp/vite.config.ts
