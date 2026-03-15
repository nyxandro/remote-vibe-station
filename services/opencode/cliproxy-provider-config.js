/**
 * @fileoverview Dynamic OpenCode provider config generator using CLIProxy /v1/models catalog.
 *
 * Exports:
 * - extractModelCatalogEntries - Validates and normalizes model descriptors from OpenAI-compatible /models payload.
 * - extractModelIdsFromCatalog - Backward-compatible helper that returns only normalized model ids.
 * - buildModelsMap - Converts model catalog rows into OpenCode provider `models` object.
 * - fetchCliproxyModelIds - Downloads model catalog from CLIProxyAPI with bearer authentication.
 * - generateOpenCodeConfigFromEnv - Builds final opencode.json payload from env + dynamic model list.
 * - writeOpenCodeConfigFromEnv - Writes generated config to target path.
 */

const fs = require("node:fs");

const CLIPROXY_MODELS_ENDPOINT_SUFFIX = "/models";
const DEFAULT_FETCH_TIMEOUT_MS = 10000;
const TELEGRAM_ATTACHMENT_DIRECTORY = "/root/.local/share/opencode/telegram-prompt-attachments/**";
const TELEGRAM_AGENT_SHARE_DIRECTORY = "/root/.local/share/opencode/agent-share/**";
const OPENAI_GPT5_DEFAULT_VARIANTS = {
  low: {
    reasoningEffort: "low",
    reasoningSummary: "auto",
    include: ["reasoning.encrypted_content"]
  },
  medium: {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    include: ["reasoning.encrypted_content"]
  },
  high: {
    reasoningEffort: "high",
    reasoningSummary: "auto",
    include: ["reasoning.encrypted_content"]
  }
};
const OPENAI_GPT54_VARIANTS = {
  ...OPENAI_GPT5_DEFAULT_VARIANTS,
  xhigh: {
    reasoningEffort: "xhigh",
    reasoningSummary: "auto",
    include: ["reasoning.encrypted_content"]
  }
};
const OPENAI_GPT5_PRO_VARIANTS = {
  high: {
    reasoningEffort: "high",
    reasoningSummary: "auto",
    include: ["reasoning.encrypted_content"]
  }
};
const ANTHROPIC_THINKING_VARIANTS = {
  high: {
    thinking: {
      type: "enabled",
      budgetTokens: 16000
    }
  },
  max: {
    thinking: {
      type: "enabled",
      budgetTokens: 31999
    }
  }
};
const GEMINI_THINKING_VARIANTS = {
  high: {
    thinkingConfig: {
      includeThoughts: true,
      thinkingBudget: 16000
    }
  },
  max: {
    thinkingConfig: {
      includeThoughts: true,
      thinkingBudget: 24576
    }
  }
};

function isPlainObject(value) {
  /* OpenCode config roots and provider maps must stay object-shaped for safe merging. */
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

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

function extractModelCatalogEntries(payload) {
  /* CLIProxy follows OpenAI-compatible response format: { object: "list", data: [{ id, modalities? }] }. */
  const rows = payload && typeof payload === "object" ? payload.data : null;
  if (!Array.isArray(rows)) {
    throw new Error("CLIProxy /models payload must contain data array");
  }

  /* Preserve provider order, but deduplicate and drop malformed ids. */
  const seen = new Set();
  const entries = [];
  for (const row of rows) {
    const modelID = String(row?.id ?? "").trim();
    if (!modelID || seen.has(modelID)) {
      continue;
    }
    seen.add(modelID);
    const modalities = normalizeModalities(row?.modalities);
    entries.push({
      id: modelID,
      ...(modalities ? { modalities } : {})
    });
  }

  if (entries.length === 0) {
    throw new Error("CLIProxy /models did not return any models");
  }

  return entries;
}

function extractModelIdsFromCatalog(payload) {
  /* Keep the legacy helper for existing tests and callers that only need ids. */
  return extractModelCatalogEntries(payload).map((entry) => entry.id);
}

function buildModelsMap(modelCatalog) {
  /* OpenCode provider config expects object map: modelId -> { name, attachment?, modalities?, variants? }. */
  return modelCatalog.reduce((acc, entry) => {
    const descriptor = typeof entry === "string" ? { id: entry } : entry;
    const modelID = String(descriptor?.id ?? "").trim();
    if (!modelID) {
      return acc;
    }

    /* Fall back to inferred modalities because CLIProxy /models currently returns ids only. */
    const normalizedModalities = normalizeModalities(descriptor?.modalities) ?? inferModalitiesFromModelID(modelID);
    const attachment = supportsAttachments({ modelID, modalities: normalizedModalities });
    const variants = resolveVariantsForModel(modelID);

    acc[modelID] = {
      name: modelID,
      ...(attachment ? { attachment: true } : {}),
      ...(normalizedModalities ? { modalities: normalizedModalities } : {}),
      ...(variants ? { variants } : {})
    };
    return acc;
  }, {});
}

function normalizeModalities(modalities) {
  /* Persist only schema-compatible modality arrays so malformed proxy metadata never corrupts config. */
  if (!modalities || typeof modalities !== "object" || Array.isArray(modalities)) {
    return null;
  }

  const input = normalizeModalityList(modalities.input);
  const output = normalizeModalityList(modalities.output);
  if (!input || !output) {
    return null;
  }

  return { input, output };
}

function normalizeModalityList(value) {
  /* Keep deterministic modality order while dropping invalid enum values. */
  if (!Array.isArray(value)) {
    return null;
  }

  const allowed = new Set(["text", "audio", "image", "video", "pdf"]);
  const seen = new Set();
  const items = [];
  for (const item of value) {
    const normalized = String(item ?? "").trim().toLowerCase();
    if (!allowed.has(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    items.push(normalized);
  }

  return items.length > 0 ? items : null;
}

function supportsAttachments(input) {
  /* Recreate OpenCode multimodal gating for custom OpenAI-compatible providers. */
  const modalityInputs = input.modalities?.input ?? [];
  if (modalityInputs.some((item) => item !== "text")) {
    return true;
  }

  /* CLIProxy often exposes only bare ids, so infer support for well-known multimodal families. */
  const normalized = String(input.modelID ?? "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (
    normalized.startsWith("gpt-4.1") ||
    normalized.startsWith("gpt-4o") ||
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("claude-3") ||
    normalized.startsWith("claude-4") ||
    normalized.startsWith("claude-haiku-4") ||
    normalized.startsWith("claude-sonnet-4") ||
    normalized.startsWith("claude-opus-4") ||
    normalized.startsWith("gemini")
  ) {
    return true;
  }

  if (
    normalized.includes("vision") ||
    normalized.includes("multimodal") ||
    normalized.includes("omni") ||
    normalized.includes("pixtral") ||
    normalized.includes("vl") ||
    normalized.endsWith("v")
  ) {
    return true;
  }

  return false;
}

function inferModalitiesFromModelID(modelID) {
  /* Mirror current upstream families so OpenCode exposes input.image=true when catalog metadata is missing. */
  const normalized = String(modelID ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (
    normalized.startsWith("gpt-4.1") ||
    normalized.startsWith("gpt-4o") ||
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("claude-3") ||
    normalized.startsWith("claude-4") ||
    normalized.startsWith("claude-haiku-4") ||
    normalized.startsWith("claude-sonnet-4") ||
    normalized.startsWith("claude-opus-4") ||
    normalized.startsWith("gemini") ||
    normalized.includes("vision") ||
    normalized.includes("multimodal") ||
    normalized.includes("omni") ||
    normalized.includes("pixtral") ||
    normalized.includes("vl") ||
    normalized.endsWith("v")
  ) {
    return {
      input: ["text", "image"],
      output: ["text"]
    };
  }

  return null;
}

function resolveVariantsForModel(modelID) {
  /* Re-use OpenCode-native variant shapes so Telegram "thinking" picker works for proxied models. */
  const normalized = String(modelID || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  /* GPT-5.2+ supports low/medium/high/xhigh while gpt-5-pro is high-only. */
  if (normalized.startsWith("gpt-5-pro")) {
    return cloneVariants(OPENAI_GPT5_PRO_VARIANTS);
  }

  if (normalized.startsWith("gpt-5.3")) {
    return cloneVariants(OPENAI_GPT54_VARIANTS);
  }

  if (normalized.startsWith("gpt-5.2")) {
    return cloneVariants(OPENAI_GPT54_VARIANTS);
  }

  if (normalized.startsWith("gpt-5.4")) {
    return cloneVariants(OPENAI_GPT54_VARIANTS);
  }

  if (normalized.startsWith("gpt-5")) {
    return cloneVariants(OPENAI_GPT5_DEFAULT_VARIANTS);
  }

  if (normalized.startsWith("claude")) {
    return ANTHROPIC_THINKING_VARIANTS;
  }

  if (normalized.startsWith("gemini")) {
    return GEMINI_THINKING_VARIANTS;
  }

  return null;
}

function cloneVariants(variants) {
  /* Return a per-model copy so one model update never mutates another model descriptor. */
  return JSON.parse(JSON.stringify(variants));
}

async function fetchCliproxyModelCatalog(input) {
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

    return extractModelCatalogEntries(payload);
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function fetchCliproxyModelIds(input) {
  /* Keep legacy id-only helper for unit tests and low-level callers. */
  return (await fetchCliproxyModelCatalog(input)).map((entry) => entry.id);
}

async function generateOpenCodeConfigFromEnv(env, options = {}) {
  /* Keep provider id/name defaults for backward compatibility with existing deployments. */
  const providerID = String(env.CLIPROXY_PROVIDER_ID || "cliproxy").trim();
  const providerName = String(env.CLIPROXY_PROVIDER_NAME || "CLIProxy").trim();
  const baseURL = normalizeBaseUrl(env.CLIPROXY_BASE_URL);
  const apiKey = normalizeNonEmpty(env.CLIPROXY_API_KEY, "CLIPROXY_API_KEY");
  const modelCatalog = await fetchCliproxyModelCatalog({
    baseURL,
    apiKey,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs
  });
  const modelIDs = modelCatalog.map((entry) => entry.id);

  /* Explicit default model must exist in discovered runtime catalog. */
  const explicitDefaultModel = String(env.CLIPROXY_DEFAULT_MODEL_ID || "").trim();
  if (explicitDefaultModel && !modelIDs.includes(explicitDefaultModel)) {
    throw new Error(`Default model '${explicitDefaultModel}' not found in CLIProxy /models`);
  }

  return {
    $schema: "https://opencode.ai/config.json",
    permission: buildManagedPermissionConfig(),
    provider: {
      [providerID]: {
        npm: "@ai-sdk/openai-compatible",
        name: providerName,
        options: {
          baseURL,
          apiKey
        },
        models: buildModelsMap(modelCatalog)
      }
    }
  };
}

function readExistingOpenCodeConfig(configPath) {
  /* Preserve user-managed sections like MCP servers when the runtime refreshes managed provider config. */
  if (!fs.existsSync(configPath)) {
    return {};
  }

  const raw = fs.readFileSync(configPath, "utf8");
  if (!raw.trim()) {
    return {};
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(`Existing OpenCode config contains invalid JSON: ${details}`);
  }

  if (!isPlainObject(parsed)) {
    throw new Error("Existing OpenCode config must be a JSON object");
  }

  if (parsed.provider !== undefined && !isPlainObject(parsed.provider)) {
    throw new Error("Existing OpenCode config provider section must be a JSON object");
  }

  return parsed;
}

function mergeManagedProviderConfig(existingConfig, generatedConfig, providerID) {
  /* Refresh only the managed CLIProxy provider branch and keep unrelated OpenCode settings untouched. */
  const existingProviders = isPlainObject(existingConfig.provider) ? existingConfig.provider : {};
  const generatedProviders = isPlainObject(generatedConfig.provider) ? generatedConfig.provider : {};
  const mergedPermission = mergeManagedPermissionConfig(existingConfig.permission, generatedConfig.permission);

  return {
    ...existingConfig,
    ...generatedConfig,
    ...(mergedPermission ? { permission: mergedPermission } : {}),
    provider: {
      ...existingProviders,
      ...generatedProviders,
      [providerID]: generatedProviders[providerID]
    }
  };
}

function mergeManagedPermissionConfig(existingPermission, generatedPermission) {
  /* Preserve user policy while auto-allowing known Telegram attachment directory for image prompts. */
  const normalizedExisting = isPlainObject(existingPermission) ? existingPermission : null;
  const normalizedGenerated = isPlainObject(generatedPermission) ? generatedPermission : null;

  if (!normalizedExisting && !normalizedGenerated) {
    return null;
  }

  const existingExternalDirectory = normalizePermissionRule(normalizedExisting?.external_directory);
  const generatedExternalDirectory = normalizePermissionRule(normalizedGenerated?.external_directory);

  return {
    ...(normalizedExisting ?? {}),
    ...(normalizedGenerated ?? {}),
    external_directory: {
      ...(existingExternalDirectory ?? {}),
      ...(generatedExternalDirectory ?? {})
    }
  };
}

function normalizePermissionRule(rule) {
  /* Schema allows either scalar action or object map; use object form for targeted path exceptions. */
  if (!rule) {
    return null;
  }

  if (typeof rule === "string") {
    return { "*": rule };
  }

  return isPlainObject(rule) ? rule : null;
}

function buildManagedPermissionConfig() {
  /* Telegram uploads and agent share files live outside the project worktree, so OpenCode must not ask every time. */
  return {
    external_directory: {
      [TELEGRAM_ATTACHMENT_DIRECTORY]: "allow",
      [TELEGRAM_AGENT_SHARE_DIRECTORY]: "allow"
    }
  };
}

async function writeOpenCodeConfigFromEnv(outPath, env = process.env, options = {}) {
  /* Single writer helper keeps entrypoint shell script minimal and deterministic. */
  const generatedConfig = await generateOpenCodeConfigFromEnv(env, options);
  const providerID = String(env.CLIPROXY_PROVIDER_ID || "cliproxy").trim();
  const existingConfig = readExistingOpenCodeConfig(outPath);
  const mergedConfig = mergeManagedProviderConfig(existingConfig, generatedConfig, providerID);

  fs.writeFileSync(outPath, `${JSON.stringify(mergedConfig, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600
  });
}

module.exports = {
  extractModelIdsFromCatalog,
  extractModelCatalogEntries,
  buildModelsMap,
  fetchCliproxyModelCatalog,
  fetchCliproxyModelIds,
  generateOpenCodeConfigFromEnv,
  mergeManagedProviderConfig,
  readExistingOpenCodeConfig,
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
