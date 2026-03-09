/**
 * @fileoverview Sync default kanban plugin assets into the persisted OpenCode config volume.
 *
 * Exports:
 * - ensureKanbanPluginAssets - Copies plugin source and merges required package dependencies.
 */

const fs = require("node:fs");
const path = require("node:path");

const PLUGIN_FILE_NAME = "kanban-tools.ts";
const PLUGIN_PACKAGE_NAME = "@opencode-ai/plugin";
const PLUGIN_PACKAGE_VERSION = "latest";

const readJsonFile = (filePath) => {
  /* Missing or invalid package.json should not block startup; we rebuild a minimal object instead. */
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
};

const writeJsonFile = (filePath, value) => {
  /* Pretty JSON keeps the shared config volume inspectable for operators. */
  try {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
  } catch (error) {
    console.error(`Failed to write kanban plugin package file '${filePath}':`, error);
    throw error;
  }
};

const ensureKanbanPluginAssets = ({ configDir, pluginSourcePath }) => {
  /* OpenCode loads local plugins from ~/.config/opencode/plugins at startup. */
  if (typeof configDir !== "string" || configDir.trim().length === 0) {
    throw new TypeError("configDir must be a non-empty string for kanban plugin sync");
  }
  if (typeof pluginSourcePath !== "string" || pluginSourcePath.trim().length === 0) {
    throw new TypeError(`pluginSourcePath must be a non-empty string for ${PLUGIN_FILE_NAME}`);
  }

  const pluginsDir = path.join(configDir, "plugins");
  const packageJsonPath = path.join(configDir, "package.json");
  const targetPluginPath = path.join(pluginsDir, PLUGIN_FILE_NAME);

  fs.mkdirSync(pluginsDir, { recursive: true });
  if (!fs.existsSync(pluginSourcePath)) {
    throw new Error(`Kanban plugin source file not found: ${pluginSourcePath}`);
  }
  fs.copyFileSync(pluginSourcePath, targetPluginPath);

  /* Local plugin helpers live in a per-config package.json installed by OpenCode via Bun. */
  const packageJson = readJsonFile(packageJsonPath);
  packageJson.dependencies = {
    ...(packageJson.dependencies ?? {}),
    [PLUGIN_PACKAGE_NAME]: packageJson.dependencies?.[PLUGIN_PACKAGE_NAME] ?? PLUGIN_PACKAGE_VERSION
  };
  writeJsonFile(packageJsonPath, packageJson);

  return {
    packageJsonPath,
    targetPluginPath
  };
};

if (require.main === module) {
  /* Entrypoint mode pulls paths from env and syncs assets before opencode serve starts. */
  const configDir = process.env.OPENCODE_CONFIG_DIR || "/root/.config/opencode";
  const pluginSourcePath = process.argv[2];

  if (!pluginSourcePath) {
    throw new Error("Plugin source path is required");
  }

  ensureKanbanPluginAssets({ configDir, pluginSourcePath });
}

module.exports = {
  ensureKanbanPluginAssets
};
