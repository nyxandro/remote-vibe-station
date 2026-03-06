#!/usr/bin/env sh

set -eu

# Configure OpenCode provider defaults for CLIProxyAPI.
# The container generates /root/.config/opencode/opencode.json at startup,
# so OpenCode immediately sees a preconnected OpenAI-compatible provider.
CONFIG_DIR="${OPENCODE_CONFIG_DIR:-/root/.config/opencode}"
CONFIG_PATH="${CONFIG_DIR}/opencode.json"
TMP_PATH="${CONFIG_PATH}.tmp"

# Require base URL and API key to avoid silently generating broken config.
if [ -z "${CLIPROXY_BASE_URL:-}" ] || [ -z "${CLIPROXY_API_KEY:-}" ]; then
  exec "$@"
fi

# Ensure target config directory exists before writing a new file.
mkdir -p "$CONFIG_DIR"

# Build provider config from live CLIProxy /v1/models to avoid manual model mapping maintenance.
node /usr/local/bin/cliproxy-provider-config.js "$TMP_PATH"

mv "$TMP_PATH" "$CONFIG_PATH"

# Continue with OpenCode server process.
exec "$@"
