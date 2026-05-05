/**
 * @fileoverview Tests for OpenCode skill catalog installation service.
 *
 * Exports:
 * - none (Jest test suite).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { OpenCodeSkillsService } from "../opencode-skills.service";

const buildJsonResponse = (payload: unknown, ok = true, status = 200): Response => {
  /* Tests only need the fetch Response surface consumed by the service. */
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  } as Response;
};

describe("OpenCodeSkillsService", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    /* Restore fetch so mocked catalog responses do not leak across test cases. */
    global.fetch = originalFetch;
  });

  test("searches remote catalog and marks installed skills", async () => {
    /* Installed status comes from the OpenCode config volume, not from NeuralDeep. */
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-skills-"));
    const configRoot = path.join(tmpRoot, "opencode-config");
    fs.mkdirSync(path.join(configRoot, "skills", "seo-review"), { recursive: true });
    fs.writeFileSync(path.join(configRoot, "skills", "seo-review", "SKILL.md"), "# SEO\n", "utf-8");

    try {
      const fetchMock = jest.fn().mockResolvedValue(
        buildJsonResponse([
          {
            id: "skill-1",
            name: "seo-review",
            owner: "owner",
            repo: "repo",
            description: "SEO audit",
            installs: 10,
            tags: ["seo"],
            category: "content",
            featured: true,
            githubStars: 7,
            type: "skill"
          }
        ])
      );

      global.fetch = fetchMock as any;
      const service = new OpenCodeSkillsService({ opencodeConfigDir: configRoot } as any);
      const result = await service.searchCatalog({ query: "seo", installed: "all" });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://neuraldeep.ru/api/skills?q=seo",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(result).toEqual([
        expect.objectContaining({ id: "skill-1", name: "seo-review", installed: true })
      ]);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("installs SKILL.md into safe OpenCode skills directory", async () => {
    /* Installation writes only the selected skill directory and never trusts remote paths for disk placement. */
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-skills-"));
    const configRoot = path.join(tmpRoot, "opencode-config");

    try {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce(
          buildJsonResponse({
            content: "# Yandex Wordstat\n\nUseful skill.",
            path: "plugins/yandex-wordstat/skills/yandex-wordstat/SKILL.md"
          })
        )
        .mockResolvedValueOnce(buildJsonResponse({ tracked: true, installs: 321 }));

      global.fetch = fetchMock as any;
      const service = new OpenCodeSkillsService({ opencodeConfigDir: configRoot } as any);
      const result = await service.installSkill({ id: "skill-1", name: "yandex-wordstat", owner: "owner", repo: "repo" });

      expect(result).toEqual({ installed: true, name: "yandex-wordstat", relativePath: "skills/yandex-wordstat/SKILL.md" });
      expect(fs.readFileSync(path.join(configRoot, "skills", "yandex-wordstat", "SKILL.md"), "utf-8")).toContain(
        "# Yandex Wordstat"
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "https://neuraldeep.ru/api/skills/readme?skillId=skill-1",
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        "https://neuraldeep.ru/api/skills/install",
        expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) })
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("removes only a safe installed skill directory", async () => {
    /* Delete is constrained to one sanitized child of the global skills root. */
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rvs-skills-"));
    const configRoot = path.join(tmpRoot, "opencode-config");
    const skillDir = path.join(configRoot, "skills", "pretty-mermaid");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Pretty Mermaid\n", "utf-8");

    try {
      const service = new OpenCodeSkillsService({ opencodeConfigDir: configRoot } as any);
      const result = service.uninstallSkill("pretty-mermaid");

      expect(result).toEqual({ removed: true, name: "pretty-mermaid" });
      expect(fs.existsSync(skillDir)).toBe(false);
      expect(() => service.uninstallSkill("../AGENTS.md")).toThrow("APP_SKILL_NAME_INVALID");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
