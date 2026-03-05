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

# Generate JSON via Node to guarantee valid escaping and structure.
node - <<'NODE' "$TMP_PATH"
const fs = require("node:fs");

const outPath = process.argv[2];
const providerID = String(process.env.CLIPROXY_PROVIDER_ID || "cliproxy").trim();
const providerName = String(process.env.CLIPROXY_PROVIDER_NAME || "CLIProxy").trim();
const baseURL = String(process.env.CLIPROXY_BASE_URL || "").trim();
const apiKey = String(process.env.CLIPROXY_API_KEY || "").trim();

let models = {};
const modelsRaw = process.env.CLIPROXY_MODELS_JSON || "";
if (modelsRaw.trim()) {
  try {
    const source = JSON.parse(modelsRaw);
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("CLIPROXY_MODELS_JSON must be a JSON object");
    }

    for (const [id, label] of Object.entries(source)) {
      const modelID = String(id || "").trim();
      const modelName = String(label || "").trim();
      if (!modelID || !modelName) {
        continue;
      }
      models[modelID] = { name: modelName };
    }
  } catch (error) {
    process.stderr.write("[opencode-entrypoint] Invalid CLIPROXY_MODELS_JSON, skipping model map\n");
    models = {};
  }
}

const config = {
  $schema: "https://opencode.ai/config.json",
  provider: {
    [providerID]: {
      npm: "@ai-sdk/openai-compatible",
      name: providerName,
      options: {
        baseURL,
        apiKey
      },
      models
    }
  }
};

fs.writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
NODE

mv "$TMP_PATH" "$CONFIG_PATH"

# Continue with OpenCode server process.
exec "$@"
