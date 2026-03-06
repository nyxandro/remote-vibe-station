/**
 * @fileoverview Tests for dynamic CLIProxy model catalog -> OpenCode config generation.
 *
 * Exports:
 * - none (node:test suite validating cliproxy-provider-config module behavior).
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildModelsMap,
  extractModelIdsFromCatalog,
  generateOpenCodeConfigFromEnv
} = require("../cliproxy-provider-config");

test("extractModelIdsFromCatalog returns unique non-empty model ids", () => {
  /* Catalog parser should keep deterministic model order while skipping invalid entries. */
  const ids = extractModelIdsFromCatalog({
    data: [
      { id: "gpt-5" },
      { id: "gpt-5" },
      { id: " claude-sonnet " },
      { id: "" },
      {}
    ]
  });

  assert.deepEqual(ids, ["gpt-5", "claude-sonnet"]);
});

test("extractModelIdsFromCatalog throws on empty catalog", () => {
  /* Empty data payload should fail fast, otherwise OpenCode starts with a broken provider state. */
  assert.throws(() => {
    extractModelIdsFromCatalog({ data: [] });
  }, /did not return any models/i);
});

test("buildModelsMap maps every id to OpenCode model descriptor", () => {
  /* OpenCode provider config expects object shape { modelId: { name } }. */
  assert.deepEqual(buildModelsMap(["gpt-5", "claude-sonnet"]), {
    "gpt-5": { name: "gpt-5" },
    "claude-sonnet": { name: "claude-sonnet" }
  });
});

test("generateOpenCodeConfigFromEnv fetches /models and builds provider config", async () => {
  /* Dynamic config generation must rely on CLIProxy catalog instead of static CLIPROXY_MODELS_JSON. */
  const calls = [];
  const config = await generateOpenCodeConfigFromEnv(
    {
      CLIPROXY_PROVIDER_ID: "cliproxy",
      CLIPROXY_PROVIDER_NAME: "CLIProxy",
      CLIPROXY_BASE_URL: "http://cliproxy:8317/v1",
      CLIPROXY_API_KEY: "sk-test",
      CLIPROXY_DEFAULT_MODEL_ID: "gpt-5"
    },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: [{ id: "gpt-5" }, { id: "gpt-5-codex" }] })
        };
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://cliproxy:8317/v1/models");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test");
  assert.deepEqual(config.provider.cliproxy.models, {
    "gpt-5": { name: "gpt-5" },
    "gpt-5-codex": { name: "gpt-5-codex" }
  });
});

test("generateOpenCodeConfigFromEnv fails when default model is absent in catalog", async () => {
  /* Explicit default model id must match discovered models to avoid invalid runtime defaults. */
  await assert.rejects(
    generateOpenCodeConfigFromEnv(
      {
        CLIPROXY_PROVIDER_ID: "cliproxy",
        CLIPROXY_PROVIDER_NAME: "CLIProxy",
        CLIPROXY_BASE_URL: "http://cliproxy:8317/v1",
        CLIPROXY_API_KEY: "sk-test",
        CLIPROXY_DEFAULT_MODEL_ID: "gpt-5.999"
      },
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: [{ id: "gpt-5" }] })
        })
      }
    ),
    /default model.*not found/i
  );
});
