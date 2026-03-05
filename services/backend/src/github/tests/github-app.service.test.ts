/**
 * @fileoverview Tests for GitHub App connect flow service.
 *
 * Exports:
 * - (none)
 */

import { GithubAppService } from "../github-app.service";

describe("GithubAppService", () => {
  const buildService = () => {
    /* Keep all dependencies explicit so tests cover service behavior only. */
    const store = {
      savePendingState: jest.fn(),
      consumePendingState: jest.fn(),
      saveInstallation: jest.fn(),
      deleteInstallation: jest.fn(),
      getInstallation: jest.fn(),
      pruneExpiredStates: jest.fn()
    };

    const config = {
      telegramBotToken: "bot-token",
      adminIds: [1],
      publicBaseUrl: "https://example.com",
      publicDomain: "example.com",
      projectsRoot: "/srv/projects",
      opencodeSyncOnStart: true,
      opencodeWarmRecentsOnStart: false,
      opencodeWarmRecentsLimit: 50,
      opencodeServerUrl: "http://opencode:4096",
      eventBufferSize: 100,
      githubAppId: "123456",
      githubAppSlug: "my-station",
      githubAppPrivateKeyBase64: Buffer.from("-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----").toString("base64")
    } as any;

    const service = new GithubAppService(config, store as never);
    return { service, store };
  };

  test("creates installation URL with state and expiration", () => {
    /* Mini App should get a deterministic GitHub install URL and polling token. */
    const { service, store } = buildService();
    const result = service.startInstall(42);

    expect(result.url.startsWith("https://github.com/apps/my-station/installations/new?state=")).toBe(true);
    expect(result.state.length).toBeGreaterThanOrEqual(30);
    expect(typeof result.expiresAt).toBe("string");
    expect(store.savePendingState).toHaveBeenCalledTimes(1);
  });

  test("completes callback and saves installation", () => {
    /* Callback should bind GitHub installation to admin after state validation. */
    const { service, store } = buildService();
    store.consumePendingState.mockReturnValue({
      adminId: 42,
      state: "ok-state",
      createdAt: "2026-01-01T10:00:00.000Z",
      expiresAt: "2999-01-01T10:15:00.000Z"
    });

    const output = service.completeInstall({
      state: "ok-state",
      installation_id: "778899",
      setup_action: "install",
      account: { login: "my-org", type: "Organization" }
    });

    expect(output.adminId).toBe(42);
    expect(output.installationId).toBe(778899);
    expect(store.saveInstallation).toHaveBeenCalledTimes(1);
  });

  test("fails fast when GitHub app is not configured", () => {
    /* Missing required app metadata should never produce a fake connect URL. */
    const store = {
      savePendingState: jest.fn(),
      consumePendingState: jest.fn(),
      saveInstallation: jest.fn(),
      deleteInstallation: jest.fn(),
      getInstallation: jest.fn(),
      pruneExpiredStates: jest.fn()
    };

    const service = new GithubAppService(
      {
        telegramBotToken: "bot-token",
        adminIds: [1],
        publicBaseUrl: "https://example.com",
        publicDomain: "example.com",
        projectsRoot: "/srv/projects",
        opencodeSyncOnStart: true,
        opencodeWarmRecentsOnStart: false,
        opencodeWarmRecentsLimit: 50,
        opencodeServerUrl: "http://opencode:4096",
        eventBufferSize: 100
      } as any,
      store as never
    );

    expect(() => service.startInstall(42)).toThrow("GitHub App is not configured");
  });
});
