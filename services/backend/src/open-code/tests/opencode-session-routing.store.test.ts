/**
 * @fileoverview Tests for OpenCode session routing TTL refresh behavior.
 *
 * Exports:
 * - none (Jest suite).
 */

import { OpenCodeSessionRoutingStore } from "../opencode-session-routing.store";

describe("OpenCodeSessionRoutingStore", () => {
  beforeEach(() => {
    /* Fake timers keep TTL behavior deterministic for long-session routing checks. */
    jest.useFakeTimers();
  });

  afterEach(() => {
    /* Restore real timers so routing TTL tests cannot leak into unrelated suites. */
    jest.useRealTimers();
  });

  it("refreshes session route ttl on every successful resolve during a long active turn", () => {
    /* Active long sessions should keep their Telegram routing while runtime events continue to arrive. */
    const store = new OpenCodeSessionRoutingStore();

    jest.setSystemTime(new Date("2026-03-22T09:00:00.000Z"));
    store.bind("session-long", { adminId: 42, directory: "/srv/projects/alpha" });

    jest.setSystemTime(new Date("2026-03-22T14:59:00.000Z"));
    expect(store.resolve("session-long")).toEqual({ adminId: 42, directory: "/srv/projects/alpha" });

    jest.setSystemTime(new Date("2026-03-22T20:58:00.000Z"));
    expect(store.resolve("session-long")).toEqual({ adminId: 42, directory: "/srv/projects/alpha" });
  });
});
