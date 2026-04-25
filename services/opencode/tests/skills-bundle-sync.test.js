/**
 * @fileoverview Tests for syncing the managed OpenCode skills bundle into the config volume.
 *
 * Exports:
 * - none (node:test suite validating full replacement of managed skill folders only).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ensureBundledSkillAssets } = require("../skills-bundle-sync.js");

test("ensureBundledSkillAssets replaces managed skill directories and leaves unrelated server skills untouched", () => {
  /* Server-managed skills should exactly match the project bundle without clobbering user-installed unrelated skills. */
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-skills-bundle-"));

  try {
    const configDir = path.join(tempRoot, "config");
    const bundledSkillsDir = path.join(tempRoot, "bundle");
    const managedSkillDir = path.join(bundledSkillsDir, "skill-a");
    const secondManagedSkillDir = path.join(bundledSkillsDir, "skill-b");
    const existingManagedSkillDir = path.join(configDir, "skills", "skill-a");
    const unrelatedSkillDir = path.join(configDir, "skills", "custom-user-skill");

    fs.mkdirSync(path.join(managedSkillDir, "references"), { recursive: true });
    fs.mkdirSync(secondManagedSkillDir, { recursive: true });
    fs.mkdirSync(existingManagedSkillDir, { recursive: true });
    fs.mkdirSync(unrelatedSkillDir, { recursive: true });

    fs.writeFileSync(path.join(managedSkillDir, "SKILL.md"), "managed-a\n", "utf8");
    fs.writeFileSync(path.join(managedSkillDir, "references", "rules.md"), "fresh\n", "utf8");
    fs.writeFileSync(path.join(secondManagedSkillDir, "SKILL.md"), "managed-b\n", "utf8");

    fs.writeFileSync(path.join(existingManagedSkillDir, "SKILL.md"), "old\n", "utf8");
    fs.writeFileSync(path.join(existingManagedSkillDir, "stale.txt"), "remove-me\n", "utf8");
    fs.writeFileSync(path.join(unrelatedSkillDir, "SKILL.md"), "keep-me\n", "utf8");

    const result = ensureBundledSkillAssets({ configDir, bundledSkillsDir });

    assert.deepEqual(result.managedSkillNames, ["skill-a", "skill-b"]);
    assert.equal(fs.readFileSync(path.join(configDir, "skills", "skill-a", "SKILL.md"), "utf8"), "managed-a\n");
    assert.equal(fs.readFileSync(path.join(configDir, "skills", "skill-a", "references", "rules.md"), "utf8"), "fresh\n");
    assert.equal(fs.existsSync(path.join(configDir, "skills", "skill-a", "stale.txt")), false);
    assert.equal(fs.readFileSync(path.join(configDir, "skills", "skill-b", "SKILL.md"), "utf8"), "managed-b\n");
    assert.equal(fs.readFileSync(path.join(configDir, "skills", "custom-user-skill", "SKILL.md"), "utf8"), "keep-me\n");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
