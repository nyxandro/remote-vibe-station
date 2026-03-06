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
  /* Dynamic mapper should attach thinking variants for known model families. */
  assert.deepEqual(
    buildModelsMap([
      "gpt-5.2",
      "gpt-5.3-codex",
      "gpt-5.4",
      "gpt-5-pro",
      "claude-sonnet",
      "gemini-2.5-pro",
      "random-model"
    ]),
    {
    "gpt-5.2": {
      name: "gpt-5.2",
      variants: {
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
        },
        xhigh: {
          reasoningEffort: "xhigh",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"]
        }
      }
    },
    "gpt-5.3-codex": {
      name: "gpt-5.3-codex",
      variants: {
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
        },
        xhigh: {
          reasoningEffort: "xhigh",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"]
        }
      }
    },
    "gpt-5.4": {
      name: "gpt-5.4",
      variants: {
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
        },
        xhigh: {
          reasoningEffort: "xhigh",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"]
        }
      }
    },
    "gpt-5-pro": {
      name: "gpt-5-pro",
      variants: {
        high: {
          reasoningEffort: "high",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"]
        }
      }
    },
    "claude-sonnet": {
      name: "claude-sonnet",
      variants: {
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
      }
    },
    "gemini-2.5-pro": {
      name: "gemini-2.5-pro",
      variants: {
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
      }
    },
    "random-model": {
      name: "random-model"
    }
  }
  );
});

test("generateOpenCodeConfigFromEnv fetches /models and builds provider config", async () => {
  /* Dynamic config generation must rely on CLIProxy catalog instead of static CLIPROXY_MODELS_JSON. */
  const calls = [];
  const config = await generateOpenCodeConfigFromEnv(
    {
      CLIPROXY_PROVIDER_ID: "cliproxy",
      CLIPROXY_PROVIDER_NAME: "CLIProxy",
      CLIPROXY_BASE_URL: "http://cliproxy:8317/v1",
      CLIPROXY_API_KEY: "sk-test"
    },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ data: [{ id: "gpt-5.2" }, { id: "gpt-5.3-codex" }, { id: "gpt-5.4" }, { id: "gpt-5-pro" }] })
        };
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://cliproxy:8317/v1/models");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-test");
  assert.deepEqual(config.provider.cliproxy.models, {
    "gpt-5.2": {
      name: "gpt-5.2",
      variants: {
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
        },
        xhigh: {
          reasoningEffort: "xhigh",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"]
        }
      }
    },
    "gpt-5.3-codex": {
      name: "gpt-5.3-codex",
      variants: {
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
        },
        xhigh: {
          reasoningEffort: "xhigh",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"]
        }
      }
    },
    "gpt-5.4": {
      name: "gpt-5.4",
      variants: {
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
        },
        xhigh: {
          reasoningEffort: "xhigh",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"]
        }
      }
    },
    "gpt-5-pro": {
      name: "gpt-5-pro",
      variants: {
        high: {
          reasoningEffort: "high",
          reasoningSummary: "auto",
          include: ["reasoning.encrypted_content"]
        }
      }
    }
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
