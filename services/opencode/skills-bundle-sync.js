/**
 * @fileoverview Sync bundled managed OpenCode skills into the persisted config volume.
 *
 * Exports:
 * - ensureBundledSkillAssets - Replaces only managed skill directories under ~/.config/opencode/skills.
 */

const fs = require("node:fs");
const path = require("node:path");

const copyDirectoryRecursive = (sourceDir, targetDir) => {
  /* Skill bundles can contain nested scripts, assets, and references, so copy the full tree verbatim. */
  fs.mkdirSync(targetDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
  }
};

const listSkillDirectories = (rootDir) => {
  /* Only top-level directories with SKILL.md count as managed skills. */
  if (!fs.existsSync(rootDir)) {
    throw new Error(`Bundled skills root directory not found: ${rootDir}`);
  }

  return fs
    .readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((dirName) => fs.existsSync(path.join(rootDir, dirName, "SKILL.md")));
};

const ensureBundledSkillAssets = ({ configDir, bundledSkillsDir }) => {
  /* The project defines a managed skill bundle; only those skill folders should be refreshed in the config volume. */
  if (typeof configDir !== "string" || configDir.trim().length === 0) {
    throw new TypeError("configDir must be a non-empty string for bundled skill sync");
  }
  if (typeof bundledSkillsDir !== "string" || bundledSkillsDir.trim().length === 0) {
    throw new TypeError("bundledSkillsDir must be a non-empty string for bundled skill sync");
  }

  const skillsDir = path.join(configDir, "skills");
  const managedSkillNames = listSkillDirectories(bundledSkillsDir);

  fs.mkdirSync(skillsDir, { recursive: true });

  for (const skillName of managedSkillNames) {
    const sourceDir = path.join(bundledSkillsDir, skillName);
    const targetDir = path.join(skillsDir, skillName);

    /* Replace the whole managed skill directory so stale files from old revisions cannot survive. */
    fs.rmSync(targetDir, { recursive: true, force: true });
    copyDirectoryRecursive(sourceDir, targetDir);
  }

  return {
    managedSkillNames,
    targetSkillsDir: skillsDir
  };
};

if (require.main === module) {
  /* Entrypoint mode syncs every bundled managed skill before opencode serve reads ~/.config/opencode/skills. */
  const configDir = process.env.OPENCODE_CONFIG_DIR || "/root/.config/opencode";
  const bundledSkillsDir = process.argv[2];

  if (!bundledSkillsDir) {
    throw new Error("Bundled skills directory is required");
  }

  ensureBundledSkillAssets({ configDir, bundledSkillsDir });
}

module.exports = {
  ensureBundledSkillAssets
};
