/**
 * @fileoverview Tests for global GitHub PAT service behavior.
 */

import { GithubAppService } from "../github-app.service";

describe("GithubAppService", () => {
  const buildService = () => {
    /* Keep store interactions explicit so tests validate PAT logic only. */
    const store = {
      getToken: jest.fn(),
      saveToken: jest.fn(),
      deleteToken: jest.fn()
    };

    const service = new GithubAppService(store as never);
    return { service, store };
  };

  test("reports disconnected state when PAT is missing", () => {
    /* Settings screen must clearly show that git auth is unavailable until a token is saved. */
    const { service, store } = buildService();
    store.getToken.mockReturnValue(null);

    expect(service.getStatus(42)).toEqual({
      configured: true,
      connected: false,
      gitCredential: {
        connected: false,
        mode: "pat"
      }
    });
  });

  test("saves trimmed PAT globally", () => {
    /* Pasted tokens should be normalized once and then reused across all projects on the instance. */
    const { service, store } = buildService();

    const result = service.saveToken({ adminId: 42, token: "  github_pat_example123  " });

    expect(result.ok).toBe(true);
    expect(store.saveToken).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 42,
        token: "github_pat_example123"
      })
    );
  });

  test("fails fast when PAT is empty", () => {
    /* Empty submissions must not silently keep stale auth state. */
    const { service } = buildService();
    expect(() => service.saveToken({ adminId: 42, token: "   " })).toThrow("GitHub token is required");
  });

  test("creates git credential payload from stored PAT", async () => {
    /* Git HTTPS helper only needs a deterministic username/password pair for github.com remotes. */
    const { service, store } = buildService();
    store.getToken.mockReturnValue({
      adminId: 42,
      token: "github_pat_example123",
      tokenPreview: "gith...e123",
      updatedAt: "2026-03-10T10:00:00.000Z"
    });

    await expect(service.createGitCredential({ protocol: "https", host: "github.com" })).resolves.toEqual({
      username: "git",
      password: "github_pat_example123",
      mode: "pat",
      updatedAt: "2026-03-10T10:00:00.000Z"
    });
  });

  test("rejects non-github hosts in git credential helper", async () => {
    /* The helper must never leak PATs to arbitrary HTTPS remotes. */
    const { service, store } = buildService();
    store.getToken.mockReturnValue({
      adminId: 42,
      token: "github_pat_example123",
      tokenPreview: "gith...e123",
      updatedAt: "2026-03-10T10:00:00.000Z"
    });

    await expect(service.createGitCredential({ protocol: "https", host: "gitlab.com" })).rejects.toThrow(
      "GitHub git credential helper supports only https://github.com"
    );
  });
});
