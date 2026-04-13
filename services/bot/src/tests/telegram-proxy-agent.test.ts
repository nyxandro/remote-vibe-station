/**
 * @fileoverview Tests for Telegram proxy agent selection.
 */

import { createTelegramProxyAgent } from "../telegram-proxy-agent";

jest.mock("https-proxy-agent", () => ({
  HttpsProxyAgent: jest.fn().mockImplementation((proxy: string) => ({
    kind: "https-proxy-agent",
    proxy
  }))
}));

const originalHttpProxy = process.env.HTTP_PROXY;
const originalHttpsProxy = process.env.HTTPS_PROXY;
const originalAllProxy = process.env.ALL_PROXY;
const originalNoProxy = process.env.NO_PROXY;

describe("createTelegramProxyAgent", () => {
  afterEach(() => {
    process.env.HTTP_PROXY = originalHttpProxy;
    process.env.HTTPS_PROXY = originalHttpsProxy;
    process.env.ALL_PROXY = originalAllProxy;
    process.env.NO_PROXY = originalNoProxy;
    jest.clearAllMocks();
  });

  it("returns ProxyAgent when HTTPS proxy is configured for Telegram", () => {
    /* Telegram Bot API requests must use runtime VLESS proxy when operator enabled it for bot service. */
    process.env.HTTPS_PROXY = "http://vless-proxy:8080";
    delete process.env.HTTP_PROXY;
    delete process.env.ALL_PROXY;
    delete process.env.NO_PROXY;

    const agent = createTelegramProxyAgent();

    expect(agent).toEqual(
      expect.objectContaining({
        kind: "https-proxy-agent",
        proxy: "http://vless-proxy:8080"
      })
    );
  });

  it("returns direct HTTPS agent when Telegram is explicitly excluded by NO_PROXY", () => {
    /* Explicit NO_PROXY must keep Telegram direct if operator intentionally excluded the API hostname. */
    process.env.HTTPS_PROXY = "http://vless-proxy:8080";
    process.env.NO_PROXY = "api.telegram.org";

    const agent = createTelegramProxyAgent();

    expect(agent.constructor.name).toBe("Agent");
    expect(agent).not.toEqual(expect.objectContaining({ kind: "https-proxy-agent" }));
  });
});
