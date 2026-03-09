#!/usr/bin/env sh

set -eu

# Configure OpenCode provider defaults for CLIProxyAPI.
# The container refreshes the managed provider block at startup while preserving
# unrelated user-managed config sections in /root/.config/opencode/opencode.json.
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-/root/.config/opencode}"
CONFIG_PATH="${CONFIG_DIR}/opencode.json"
TMP_PATH="${CONFIG_PATH}.tmp"

# Require base URL and API key to avoid silently generating broken config.
if [ -z "${CLIPROXY_BASE_URL:-}" ] || [ -z "${CLIPROXY_API_KEY:-}" ]; then
  exec "$@"
fi

# Ensure target config directory exists before writing a new file.
mkdir -p "$CONFIG_DIR"

# Keep shared toolbox paths present even on a fresh named volume.
mkdir -p \
  /toolbox/bin \
  /toolbox/cache/npm \
  /toolbox/cache/pip \
  /toolbox/cache/uv \
  /toolbox/npm-global \
  /toolbox/pipx \
  /toolbox/playwright \
  /toolbox/pnpm/store \
  /toolbox/python-user \
  /toolbox/uv/tools

# Seed the temp file with the existing config so the generator can merge instead
# of replacing unrelated user-managed keys like MCP server definitions.
if [ -f "$CONFIG_PATH" ]; then
  cp "$CONFIG_PATH" "$TMP_PATH"
fi

# Build provider config from live CLIProxy /v1/models to avoid manual model mapping maintenance.
node /usr/local/bin/cliproxy-provider-config.js "$TMP_PATH"

mv "$TMP_PATH" "$CONFIG_PATH"

# Continue with OpenCode server process.
exec "$@"
