#!/usr/bin/env bash

set -euo pipefail

# Validate runtime installer output without touching system services.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INSTALL_SCRIPT="$ROOT_DIR/scripts/install-runtime.sh"
INSTALL_LIB="$ROOT_DIR/scripts/runtime-installer-lib.sh"

if [[ ! -x "$INSTALL_SCRIPT" ]]; then
  echo "install script is missing or not executable: $INSTALL_SCRIPT" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Run in dry-run mode to verify deterministic file generation.
"$INSTALL_SCRIPT" \
  --dry-run \
  --install-dir "$TMP_DIR/runtime" \
  --bot-token "12345:bot-token" \
  --admin-id "100500" \
  --domain "example.com" \
  --tls-email "ops@example.com" \
  --runtime-version "9.8.7" \
  --runtime-commit-sha "abc123def456" \
  --image-tag "v9.8.7"

ENV_FILE="$TMP_DIR/runtime/.env"
COMPOSE_FILE="$TMP_DIR/runtime/docker-compose.yml"
TRAEFIK_FILE="$TMP_DIR/runtime/infra/traefik/traefik.yml"
CLIPROXY_CONFIG="$TMP_DIR/runtime/infra/cliproxy/config.yaml"
VLESS_COMPOSE_FILE="$TMP_DIR/runtime/docker-compose.vless.yml"
VLESS_ENV_FILE="$TMP_DIR/runtime/infra/vless/proxy.env"
VLESS_XRAY_FILE="$TMP_DIR/runtime/infra/vless/xray.json"
MAINTENANCE_SCRIPT="$TMP_DIR/runtime/runtime-maintenance.sh"
ACME_FILE="$TMP_DIR/runtime/infra/traefik/acme.json"

# Ensure all mandatory runtime files are present.
for required in "$ENV_FILE" "$COMPOSE_FILE" "$TRAEFIK_FILE" "$CLIPROXY_CONFIG" "$VLESS_COMPOSE_FILE" "$VLESS_ENV_FILE" "$VLESS_XRAY_FILE" "$MAINTENANCE_SCRIPT"; do
  if [[ ! -f "$required" ]]; then
    echo "missing generated file: $required" >&2
    exit 1
  fi
done

# Ensure installer writes required operator-provided values to env.
grep -q '^TELEGRAM_BOT_TOKEN=12345:bot-token$' "$ENV_FILE"
grep -q '^ADMIN_IDS=100500$' "$ENV_FILE"
grep -q '^PUBLIC_DOMAIN=example.com$' "$ENV_FILE"
grep -q '^OPENCODE_PUBLIC_DOMAIN=code.example.com$' "$ENV_FILE"
grep -q '^PROJECTS_ROOT='"$TMP_DIR"'/runtime/projects$' "$ENV_FILE"
grep -q '^RVS_RUNTIME_VERSION=9.8.7$' "$ENV_FILE"
grep -q '^RVS_RUNTIME_IMAGE_TAG=v9.8.7$' "$ENV_FILE"
grep -q '^RVS_RUNTIME_COMMIT_SHA=abc123def456$' "$ENV_FILE"

# Ensure secrets are generated and non-empty.
grep -Eq '^OPENCODE_SERVER_PASSWORD=[A-Za-z0-9]{32,}$' "$ENV_FILE"
grep -Eq '^CLIPROXY_MANAGEMENT_PASSWORD=[A-Za-z0-9]{32,}$' "$ENV_FILE"
grep -Eq '^CLIPROXY_API_KEY=sk-cliproxy-[A-Za-z0-9]{40,}$' "$ENV_FILE"
grep -Eq '^BOT_BACKEND_AUTH_TOKEN=rvs-bot-[A-Za-z0-9]{40,}$' "$ENV_FILE"
grep -q '^RVS_BACKEND_IMAGE=ghcr.io/nyxandro/remote-vibe-station-backend:v9.8.7$' "$ENV_FILE"
grep -q '^RVS_MINIAPP_IMAGE=ghcr.io/nyxandro/remote-vibe-station-miniapp:v9.8.7$' "$ENV_FILE"
grep -q '^RVS_BOT_IMAGE=ghcr.io/nyxandro/remote-vibe-station-bot:v9.8.7$' "$ENV_FILE"
grep -q '^RVS_OPENCODE_IMAGE=ghcr.io/nyxandro/remote-vibe-station-opencode:v9.8.7$' "$ENV_FILE"

# Ensure runtime compose is image-only and does not rely on local source code.
grep -q 'image: ${RVS_BACKEND_IMAGE:?RVS_BACKEND_IMAGE must be set}' "$COMPOSE_FILE"
grep -q 'image: ${RVS_MINIAPP_IMAGE:?RVS_MINIAPP_IMAGE must be set}' "$COMPOSE_FILE"
grep -q 'image: ${RVS_BOT_IMAGE:?RVS_BOT_IMAGE must be set}' "$COMPOSE_FILE"
grep -q 'image: ${RVS_OPENCODE_IMAGE:?RVS_OPENCODE_IMAGE must be set}' "$COMPOSE_FILE"
grep -q 'TELEGRAM_TRANSPORT_MODE=${TELEGRAM_TRANSPORT_MODE:-webhook}' "$COMPOSE_FILE"
grep -q 'toolbox_data:/toolbox' "$COMPOSE_FILE"
grep -q '^  toolbox_data:$' "$COMPOSE_FILE"
grep -q '^    privileged: true$' "$COMPOSE_FILE"
grep -q '^    pid: host$' "$COMPOSE_FILE"
grep -q 'RVS_HOST_COMMAND=rvs-host' "$COMPOSE_FILE"
grep -q '/:/hostfs' "$COMPOSE_FILE"
if grep -q 'build:' "$COMPOSE_FILE"; then
  echo "runtime compose must not contain build directives" >&2
  exit 1
fi

# Ensure optional VLESS files start in safe direct mode; Mini App can later generate the real proxy override.
grep -q '^services: {}$' "$VLESS_COMPOSE_FILE"
grep -q '^HTTP_PROXY=$' "$VLESS_ENV_FILE"
grep -q '^HTTPS_PROXY=$' "$VLESS_ENV_FILE"
grep -q '"inbounds": \[\]' "$VLESS_XRAY_FILE"
grep -q '"tag": "direct"' "$VLESS_XRAY_FILE"
if grep -q 'CHANGE_ME_' "$VLESS_XRAY_FILE"; then
  echo "fresh runtime must not ship placeholder VLESS credentials" >&2
  exit 1
fi

# Ensure installer deploy path always includes the optional VLESS override file.
grep -q 'docker compose --env-file \.env -f docker-compose.yml -f docker-compose.vless.yml pull' "$INSTALL_SCRIPT"
grep -q 'docker compose --env-file \.env -f docker-compose.yml -f docker-compose.vless.yml up -d --remove-orphans' "$INSTALL_SCRIPT"

# Ensure maintenance script prunes safe Docker garbage without touching named volumes.
grep -q 'docker image prune -af --filter "until=168h"' "$MAINTENANCE_SCRIPT"
grep -q 'docker builder prune --help' "$MAINTENANCE_SCRIPT"
grep -q -- '--reserved-space 512MB' "$MAINTENANCE_SCRIPT"
if grep -q 'docker volume prune' "$MAINTENANCE_SCRIPT"; then
  echo "maintenance script must not prune volumes automatically" >&2
  exit 1
fi

# Ensure installer now hardens SSH for key-only access instead of rate-limiting dynamic operator IPs.
grep -q 'configure_sshd_key_only()' "$INSTALL_LIB"
grep -q 'PasswordAuthentication no' "$INSTALL_LIB"
if grep -q 'ufw limit 22/tcp' "$INSTALL_SCRIPT"; then
  echo "installer must not reintroduce UFW SSH rate limiting for key-only access" >&2
  exit 1
fi

# Ensure generated CLIProxy config is bound to generated API key from env.
GENERATED_PROXY_KEY="$(grep '^CLIPROXY_API_KEY=' "$ENV_FILE" | cut -d= -f2-)"
if ! grep -q -- "- ${GENERATED_PROXY_KEY}" "$CLIPROXY_CONFIG"; then
  echo "cliproxy config does not contain generated api key" >&2
  exit 1
fi

# Ensure clean-server prerequisites include commands used by the preflight and optional GitHub auth is non-fatal.
grep -q 'iproute2' "$INSTALL_LIB"
grep -q 'install_github_cli_if_possible()' "$INSTALL_LIB"
grep -q 'WARNING: GitHub CLI is unavailable' "$INSTALL_LIB"

# Ensure rerunning installer does not rotate generated credentials or wipe ACME account state.
INITIAL_BOT_AUTH_TOKEN="$(grep '^BOT_BACKEND_AUTH_TOKEN=' "$ENV_FILE" | cut -d= -f2-)"
INITIAL_OPENCODE_PASSWORD="$(grep '^OPENCODE_SERVER_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)"
printf '%s\n' '{"Account":"keep"}' >"$ACME_FILE"
"$INSTALL_SCRIPT" \
  --dry-run \
  --install-dir "$TMP_DIR/runtime" \
  --bot-token "12345:bot-token" \
  --admin-id "100500" \
  --domain "example.com" \
  --tls-email "ops@example.com" \
  --runtime-version "9.8.7" \
  --runtime-commit-sha "abc123def456" \
  --image-tag "v9.8.7"
grep -q '^BOT_BACKEND_AUTH_TOKEN='"$INITIAL_BOT_AUTH_TOKEN"'$' "$ENV_FILE"
grep -q '^OPENCODE_SERVER_PASSWORD='"$INITIAL_OPENCODE_PASSWORD"'$' "$ENV_FILE"
grep -q '"Account":"keep"' "$ACME_FILE"

echo "install-runtime dry-run test passed"
