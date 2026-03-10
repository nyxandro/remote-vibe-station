/**
 * @fileoverview Tests for CLIProxy runtime auth-file mutations.
 */

import { BadRequestException } from "@nestjs/common";

import { CliproxyAuthRuntimeService } from "../cliproxy-auth-runtime.service";

describe("CliproxyAuthRuntimeService", () => {
  const originalRuntimeConfigDir = process.env.RUNTIME_CONFIG_DIR;

  afterEach(() => {
    /* Restore env and mock state so runtime path validation stays isolated per test. */
    process.env.RUNTIME_CONFIG_DIR = originalRuntimeConfigDir;
    jest.restoreAllMocks();
  });

  test("rejects auth file path with traversal segments", async () => {
    /* Runtime mutation should fail fast when caller passes suspicious file path. */
    process.env.RUNTIME_CONFIG_DIR = "/runtime";
    const dockerCompose = {
      run: jest.fn()
    };

    const service = new CliproxyAuthRuntimeService(dockerCompose as never);

    await expect(
      service.setDisabled({ filePath: "/root/.cli-proxy-api/../secrets.json", disabled: true })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(dockerCompose.run).not.toHaveBeenCalled();
  });

  test("executes validated auth update through docker compose", async () => {
    /* Runtime mutation must work in minimal CLIProxy images that do not ship Python. */
    process.env.RUNTIME_CONFIG_DIR = "/runtime";
    const dockerCompose = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "" })
    };

    const service = new CliproxyAuthRuntimeService(dockerCompose as never);
    await service.setDisabled({ filePath: "/root/.cli-proxy-api/codex-user@example.com.json", disabled: true });

    expect(dockerCompose.run).toHaveBeenCalledTimes(1);
    expect(dockerCompose.run).toHaveBeenCalledWith(
      expect.arrayContaining(["exec", "-T", "cliproxy", "sh", "-lc"]),
      "/runtime"
    );
    expect(dockerCompose.run.mock.calls[0][0][5]).not.toContain("python - <<'PY'");
    expect(dockerCompose.run.mock.calls[0][0][5]).toContain("awk ");
    expect(dockerCompose.run.mock.calls[0][0][5]).not.toContain("gensub(");
  });

  test("executes validated auth deletion through docker compose", async () => {
    /* Deletion should also rely only on basic shell tooling available in the CLIProxy container. */
    process.env.RUNTIME_CONFIG_DIR = "/runtime";
    const dockerCompose = {
      run: jest.fn().mockResolvedValue({ stdout: "", stderr: "" })
    };

    const service = new CliproxyAuthRuntimeService(dockerCompose as never);
    await service.deleteFile({ filePath: "/root/.cli-proxy-api/codex-user@example.com.json" });

    expect(dockerCompose.run).toHaveBeenCalledTimes(1);
    expect(dockerCompose.run).toHaveBeenCalledWith(
      expect.arrayContaining(["exec", "-T", "cliproxy", "sh", "-lc"]),
      "/runtime"
    );
    expect(dockerCompose.run.mock.calls[0][0][5]).toContain("rm -f --");
  });
});
