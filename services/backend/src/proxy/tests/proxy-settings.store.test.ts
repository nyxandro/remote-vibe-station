/**
 * @fileoverview Tests for persistent CLI/Proxy settings JSON store.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { ProxySettingsStore } from "../proxy-settings.store";

describe("ProxySettingsStore", () => {
  let tempRoot: string;
  let cwdSpy: jest.SpyInstance<string, []>;

  beforeEach(() => {
    /* Isolate store filesystem state to keep tests deterministic. */
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "proxy-settings-store-"));
    cwdSpy = jest.spyOn(process, "cwd").mockReturnValue(tempRoot);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("returns defaults when settings file does not exist", async () => {
    /* First read should provide explicit direct mode without hidden fallbacks. */
    const store = new ProxySettingsStore();

    const snapshot = await store.get();

    expect(snapshot.mode).toBe("direct");
    expect(snapshot.vlessProxyUrl).toBeNull();
    expect(snapshot.noProxy).toContain("localhost");
  });

  test("persists and reloads saved settings", async () => {
    /* Saved proxy profile must survive store re-instantiation. */
    const store = new ProxySettingsStore();
    await store.set({
      mode: "vless",
      vlessProxyUrl: "socks5://vless-proxy:1080",
      noProxy: "localhost,127.0.0.1,backend"
    });

    const reloaded = new ProxySettingsStore();
    const snapshot = await reloaded.get();

    expect(snapshot.mode).toBe("vless");
    expect(snapshot.vlessProxyUrl).toBe("socks5://vless-proxy:1080");
    expect(snapshot.noProxy).toBe("localhost,127.0.0.1,backend");
    expect(typeof snapshot.updatedAt).toBe("string");
  });
});
