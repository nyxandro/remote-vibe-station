/**
 * @fileoverview Tests for project discovery from PROJECTS_ROOT.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { discoverProjects } from "../project-discovery";

const writeFile = (filePath: string, content: string): void => {
  /* Helper: ensure parent dir exists for fixtures. */
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
};

describe("discoverProjects", () => {
  test("returns every subfolder and marks runnable when compose exists", () => {
    /* Create a temp projects root with two folders. */
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tvoc-projects-"));
    const a = path.join(root, "alpha");
    const b = path.join(root, "beta");
    fs.mkdirSync(a);
    fs.mkdirSync(b);

    /* Only alpha is runnable because it has a compose file. */
    writeFile(path.join(a, "docker-compose.yml"), "services: {}\n");

    const items = discoverProjects({ projectsRoot: root });
    const alpha = items.find((i) => i.slug === "alpha");
    const beta = items.find((i) => i.slug === "beta");

    expect(alpha).toBeTruthy();
    expect(beta).toBeTruthy();
    expect(alpha?.runnable).toBe(true);
    expect(beta?.runnable).toBe(false);
    expect(alpha?.hasCompose).toBe(true);
    expect(beta?.hasCompose).toBe(false);
  });
});
