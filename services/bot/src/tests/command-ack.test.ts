/**
 * @fileoverview Tests for Telegram acknowledgement text after slash-command dispatch.
 *
 * Exports:
 * - none (Jest suite for buildCommandQueuedMessage).
 */

import { buildCommandQueuedMessage } from "../command-ack";

describe("buildCommandQueuedMessage", () => {
  it("formats the queued workflow acknowledgement with leading slash", () => {
    /* Users should immediately see which workflow command backend accepted. */
    expect(buildCommandQueuedMessage("gitaddmaster")).toBe(
      "Workflow команда '/gitaddmaster' отправлена в чат агента."
    );
  });

  it("trims accidental whitespace around the command name", () => {
    /* Telegram parsing already normalizes commands, but the formatter should stay defensive. */
    expect(buildCommandQueuedMessage("  review_changes  ")).toBe(
      "Workflow команда '/review_changes' отправлена в чат агента."
    );
  });
});
