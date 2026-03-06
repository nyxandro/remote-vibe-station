/**
 * @fileoverview Dynamic OpenCode provider config generator using CLIProxy /v1/models catalog.
 *
 * Exports:
 * - extractModelIdsFromCatalog - Validates and normalizes model ids from OpenAI-compatible /models payload.
 * - buildModelsMap - Converts model id list into OpenCode provider `models` object.
 * - fetchCliproxyModelIds - Downloads model catalog from CLIProxyAPI with bearer authentication.
 * - generateOpenCodeConfigFromEnv - Builds final opencode.json payload from env + dynamic model list.
 * - writeOpenCodeConfigFromEnv - Writes generated config to target path.
 */

const fs = require("node:fs");

const CLIPROXY_MODELS_ENDPOINT_SUFFIX = "/models";
const DEFAULT_FETCH_TIMEOUT_MS = 10000;

function normalizeNonEmpty(input, fieldName) {
  /* Required fields must be explicit to avoid silently generating broken provider config. */
  const value = String(input ?? "").trim();
  if (!value) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

function normalizeBaseUrl(baseUrl) {
  /* Remove trailing slash so /models endpoint composition remains deterministic. */
  return normalizeNonEmpty(baseUrl, "CLIPROXY_BASE_URL").replace(/\/+$/u, "");
}

function extractModelIdsFromCatalog(payload) {
  /* CLIProxy follows OpenAI-compatible response format: { object: "list", data: [{ id }] }. */
  const rows = payload && typeof payload === "object" ? payload.data : null;
  if (!Array.isArray(rows)) {
    throw new Error("CLIProxy /models payload must contain data array");
  }

  /* Preserve provider order, but deduplicate and drop malformed ids. */
  const seen = new Set();
  const ids = [];
  for (const row of rows) {
    const modelID = String(row?.id ?? "").trim();
    if (!modelID || seen.has(modelID)) {
      continue;
    }
    seen.add(modelID);
    ids.push(modelID);
  }

  if (ids.length === 0) {
    throw new Error("CLIProxy /models did not return any models");
  }

  return ids;
}

function buildModelsMap(modelIDs) {
  /* OpenCode provider config expects object map: modelId -> { name }. */
  return modelIDs.reduce((acc, modelID) => {
    acc[modelID] = { name: modelID };
    return acc;
  }, {});
}

async function fetchCliproxyModelIds(input) {
  /* Fetch model catalog with strict timeout to fail fast on unavailable upstream. */
  const baseURL = normalizeBaseUrl(input.baseURL);
  const apiKey = normalizeNonEmpty(input.apiKey, "CLIPROXY_API_KEY");
  const timeoutMs = Number.isFinite(input.timeoutMs) ? input.timeoutMs : DEFAULT_FETCH_TIMEOUT_MS;
  const fetchImpl = input.fetchImpl ?? fetch;

  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${baseURL}${CLIPROXY_MODELS_ENDPOINT_SUFFIX}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-Api-Key": apiKey,
        Accept: "application/json"
      },
      signal: abortController.signal
    });

    if (!response.ok) {
      throw new Error(`CLIProxy /models request failed with status ${response.status}`);
    }

    const bodyText = await response.text();
    if (!bodyText.trim()) {
      throw new Error("CLIProxy /models returned empty body");
    }

    /* Parse and validate payload before producing OpenCode config. */
    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      throw new Error(`CLIProxy /models returned invalid JSON: ${details}`);
    }

    return extractModelIdsFromCatalog(payload);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function generateOpenCodeConfigFromEnv(env, options = {}) {
  /* Keep provider id/name defaults for backward compatibility with existing deployments. */
  const providerID = String(env.CLIPROXY_PROVIDER_ID || "cliproxy").trim();
  const providerName = String(env.CLIPROXY_PROVIDER_NAME || "CLIProxy").trim();
  const baseURL = normalizeBaseUrl(env.CLIPROXY_BASE_URL);
  const apiKey = normalizeNonEmpty(env.CLIPROXY_API_KEY, "CLIPROXY_API_KEY");
  const modelIDs = await fetchCliproxyModelIds({
    baseURL,
    apiKey,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs
  });

  /* Explicit default model must exist in discovered runtime catalog. */
  const explicitDefaultModel = String(env.CLIPROXY_DEFAULT_MODEL_ID || "").trim();
  if (explicitDefaultModel && !modelIDs.includes(explicitDefaultModel)) {
    throw new Error(`Default model '${explicitDefaultModel}' not found in CLIProxy /models`);
  }

  return {
    $schema: "https://opencode.ai/config.json",
    provider: {
      [providerID]: {
        npm: "@ai-sdk/openai-compatible",
        name: providerName,
        options: {
          baseURL,
          apiKey
        },
        models: buildModelsMap(modelIDs)
      }
    }
  };
}

async function writeOpenCodeConfigFromEnv(outPath, env = process.env, options = {}) {
  /* Single writer helper keeps entrypoint shell script minimal and deterministic. */
  const config = await generateOpenCodeConfigFromEnv(env, options);
  fs.writeFileSync(outPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
}

module.exports = {
  extractModelIdsFromCatalog,
  buildModelsMap,
  fetchCliproxyModelIds,
  generateOpenCodeConfigFromEnv,
  writeOpenCodeConfigFromEnv
};

if (require.main === module) {
  /* CLI mode: generate opencode.json fragment and exit non-zero on first error. */
  const outPath = process.argv[2];
  if (!outPath) {
    process.stderr.write("[opencode-entrypoint] output path argument is required\n");
    process.exit(1);
  }

  writeOpenCodeConfigFromEnv(outPath).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[opencode-entrypoint] ${message}\n`);
    process.exit(1);
  });
}
