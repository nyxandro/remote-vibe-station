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

# Refresh login-shell visibility for toolbox CLIs after persistent volume mounts.
for target in /toolbox/bin/* /toolbox/npm-global/bin/*; do
  if [ -f "$target" ] || [ -L "$target" ]; then
    ln -sf "$target" "/usr/local/bin/$(basename "$target")"
  fi
done

# Auto-update OpenCode in the shared toolbox on startup, but keep the runtime available if npm is temporarily unreachable.
if ! node /usr/local/bin/opencode-auto-update.js; then
  echo "APP_OPENCODE_AUTO_UPDATE_FAILED: Startup auto-update failed; continuing with the installed OpenCode version." >&2
fi

# Seed the temp file with the existing config so the generator can merge instead
# of replacing unrelated user-managed keys like MCP server definitions.
if [ -f "$CONFIG_PATH" ]; then
  cp "$CONFIG_PATH" "$TMP_PATH"
fi

# Build provider config from live CLIProxy /v1/models to avoid manual model mapping maintenance.
node /usr/local/bin/cliproxy-provider-config.js "$TMP_PATH"

# Sync default local plugins into the persisted config volume before OpenCode loads them.
node /usr/local/bin/kanban-plugin-sync.js /usr/local/share/opencode/kanban-tools-plugin.ts
node /usr/local/bin/telegram-media-plugin-sync.js /usr/local/share/opencode/telegram-media-tools-plugin.ts
node /usr/local/bin/skills-bundle-sync.js /usr/local/share/opencode/skills

mv "$TMP_PATH" "$CONFIG_PATH"

# Continue with OpenCode server process.
ensure_toolbox_link() {
  target_path="$1"
  persistent_path="$2"

  # Persisted toolbox directories should become the canonical home for CLI auth state.
  mkdir -p "$(dirname "$target_path")" "$persistent_path"

  # Preserve any pre-existing data before replacing the target with a symlink.
  if [ -d "$target_path" ] && [ ! -L "$target_path" ]; then
    if [ -z "$(ls -A "$persistent_path" 2>/dev/null)" ] && [ -n "$(ls -A "$target_path" 2>/dev/null)" ]; then
      cp -a "$target_path"/. "$persistent_path"/
    fi
    rm -rf "$target_path"
  fi

  if [ ! -e "$target_path" ]; then
    ln -s "$persistent_path" "$target_path"
  fi
}

# Keep long-lived CLI auth in the shared toolbox volume so redeploys do not log the agent out.
ensure_toolbox_link /root/.coderabbit /toolbox/coderabbit
ensure_toolbox_link /root/.config/coderabbit /toolbox/coderabbit-config

# Continue with OpenCode server process.
exec "$@"
