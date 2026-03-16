/**
 * @fileoverview Tests for dynamic CLIProxy model catalog -> OpenCode config generation.
 *
 * Exports:
 * - none (node:test suite validating cliproxy-provider-config module behavior).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildModelsMap,
  extractModelCatalogEntries,
  extractModelIdsFromCatalog,
  generateOpenCodeConfigFromEnv,
  writeOpenCodeConfigFromEnv
} = require("../cliproxy-provider-config");

const GPT5_XHIGH_VARIANTS = {
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
};

const GPT5_HIGH_VARIANTS = {
  high: {
    reasoningEffort: "high",
    reasoningSummary: "auto",
    include: ["reasoning.encrypted_content"]
  }
};

const CLAUDE_VARIANTS = {
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

const GEMINI_VARIANTS = {
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

test("extractModelCatalogEntries keeps schema-compatible modalities", () => {
  /* Proxy metadata should survive into OpenCode config so multimodal gating matches the upstream catalog. */
  assert.deepEqual(
    extractModelCatalogEntries({
      data: [
        {
          id: "gpt-5.4",
          modalities: {
            input: ["text", "image", "image", "invalid"],
            output: ["text"]
          }
        },
        {
          id: "broken-modalities",
          modalities: {
            input: [],
            output: ["text"]
          }
        }
      ]
    }),
    [
      {
        id: "gpt-5.4",
        modalities: {
          input: ["text", "image"],
          output: ["text"]
        }
      },
      {
        id: "broken-modalities"
      }
    ]
  );
});

test("buildModelsMap maps every id to OpenCode model descriptor", () => {
  /* Dynamic mapper should preserve multimodal support and attach thinking variants for known model families. */
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
      attachment: true,
      modalities: {
        input: ["text", "image"],
        output: ["text"]
      },
      variants: GPT5_XHIGH_VARIANTS
    },
    "gpt-5.3-codex": {
      name: "gpt-5.3-codex",
      attachment: true,
      modalities: {
        input: ["text", "image"],
        output: ["text"]
      },
      variants: GPT5_XHIGH_VARIANTS
    },
    "gpt-5.4": {
      name: "gpt-5.4",
      attachment: true,
      modalities: {
        input: ["text", "image"],
        output: ["text"]
      },
      variants: GPT5_XHIGH_VARIANTS
    },
    "gpt-5-pro": {
      name: "gpt-5-pro",
      attachment: true,
      modalities: {
        input: ["text", "image"],
        output: ["text"]
      },
      variants: GPT5_HIGH_VARIANTS
    },
    "claude-sonnet": {
      name: "claude-sonnet",
      variants: CLAUDE_VARIANTS
    },
    "gemini-2.5-pro": {
      name: "gemini-2.5-pro",
      attachment: true,
      modalities: {
        input: ["text", "image"],
        output: ["text"]
      },
      variants: GEMINI_VARIANTS
    },
    "random-model": {
      name: "random-model"
    }
  }
  );
});

test("buildModelsMap enables attachments from explicit modalities metadata", () => {
  /* Catalog-declared image/pdf input should win even for unknown model ids. */
  assert.deepEqual(
    buildModelsMap([
      {
        id: "custom-model",
        modalities: {
          input: ["text", "image", "pdf"],
          output: ["text"]
        }
      }
    ]),
    {
      "custom-model": {
        name: "custom-model",
        attachment: true,
        modalities: {
          input: ["text", "image", "pdf"],
          output: ["text"]
        }
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
      attachment: true,
      modalities: {
        input: ["text", "image"],
        output: ["text"]
      },
      variants: GPT5_XHIGH_VARIANTS
    },
    "gpt-5.3-codex": {
      name: "gpt-5.3-codex",
      attachment: true,
      modalities: {
        input: ["text", "image"],
        output: ["text"]
      },
      variants: GPT5_XHIGH_VARIANTS
    },
    "gpt-5.4": {
      name: "gpt-5.4",
      attachment: true,
      modalities: {
        input: ["text", "image"],
        output: ["text"]
      },
      variants: GPT5_XHIGH_VARIANTS
    },
    "gpt-5-pro": {
      name: "gpt-5-pro",
      attachment: true,
      modalities: {
        input: ["text", "image"],
        output: ["text"]
      },
      variants: GPT5_HIGH_VARIANTS
    }
  });
  assert.deepEqual(config.permission, {
    skill: "allow",
    external_directory: {
      "/root/.local/share/opencode/telegram-prompt-attachments/**": "allow",
      "/root/.local/share/opencode/agent-share/**": "allow"
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

test("writeOpenCodeConfigFromEnv preserves unrelated OpenCode config sections", async () => {
  /* Runtime refresh must update managed provider block without erasing MCP servers and other user config. */
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-opencode-config-"));
  const configPath = path.join(tmpRoot, "opencode.json");

  try {
    fs.writeFileSync(
      configPath,
      `${JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          theme: "nord",
          mcp: {
            servers: {
              github: {
                command: "npx",
                args: ["-y", "@modelcontextprotocol/server-github"]
              }
            }
          },
          permission: {
            "*": "allow",
            external_directory: {
              "*": "ask",
              "/tmp/manual/**": "allow"
            }
          },
          provider: {
            other: {
              npm: "@ai-sdk/openai",
              name: "OpenAI",
              options: {
                apiKey: "sk-existing"
              },
              models: {
                "gpt-4.1": {
                  name: "gpt-4.1"
                }
              }
            },
            cliproxy: {
              npm: "legacy-provider",
              name: "Old CLIProxy",
              options: {
                baseURL: "http://old-proxy/v1",
                apiKey: "old-token"
              },
              models: {
                stale: {
                  name: "stale"
                }
              }
            }
          }
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await writeOpenCodeConfigFromEnv(configPath, {
      CLIPROXY_PROVIDER_ID: "cliproxy",
      CLIPROXY_PROVIDER_NAME: "CLIProxy",
      CLIPROXY_BASE_URL: "http://cliproxy:8317/v1",
      CLIPROXY_API_KEY: "sk-test"
    }, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ id: "gpt-5.4" }] })
      })
    });

    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));

    assert.equal(saved.theme, "nord");
    assert.deepEqual(saved.mcp, {
      servers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"]
        }
      }
    });
    assert.deepEqual(saved.permission, {
      "*": "allow",
      skill: "allow",
      external_directory: {
        "*": "ask",
        "/tmp/manual/**": "allow",
        "/root/.local/share/opencode/telegram-prompt-attachments/**": "allow",
        "/root/.local/share/opencode/agent-share/**": "allow"
      }
    });
    assert.deepEqual(saved.provider.other, {
      npm: "@ai-sdk/openai",
      name: "OpenAI",
      options: {
        apiKey: "sk-existing"
      },
      models: {
        "gpt-4.1": {
          name: "gpt-4.1"
        }
      }
    });
    assert.equal(saved.provider.cliproxy.name, "CLIProxy");
    assert.equal(saved.provider.cliproxy.options.baseURL, "http://cliproxy:8317/v1");
    assert.equal(saved.provider.cliproxy.options.apiKey, "sk-test");
    assert.deepEqual(saved.provider.cliproxy.models, {
      "gpt-5.4": {
        name: "gpt-5.4",
        attachment: true,
        modalities: {
          input: ["text", "image"],
          output: ["text"]
        },
        variants: GPT5_XHIGH_VARIANTS
      }
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("writeOpenCodeConfigFromEnv fails on invalid existing JSON", async () => {
  /* Broken persisted config must stop startup instead of silently replacing user state. */
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-opencode-config-"));
  const configPath = path.join(tmpRoot, "opencode.json");

  try {
    fs.writeFileSync(configPath, "{not-json}\n", "utf8");

    await assert.rejects(
      writeOpenCodeConfigFromEnv(configPath, {
        CLIPROXY_PROVIDER_ID: "cliproxy",
        CLIPROXY_PROVIDER_NAME: "CLIProxy",
        CLIPROXY_BASE_URL: "http://cliproxy:8317/v1",
        CLIPROXY_API_KEY: "sk-test"
      }, {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ data: [{ id: "gpt-5.4" }] })
        })
      }),
      /invalid json/i
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
