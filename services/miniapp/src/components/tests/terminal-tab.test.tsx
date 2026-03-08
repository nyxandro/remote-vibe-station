/**
 * @fileoverview UI tests for TerminalTab input layout contract.
 */

/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TerminalTab } from "../TerminalTab";

describe("TerminalTab", () => {
  afterEach(() => {
    /* Reset DOM between tests so command controls stay deterministic. */
    cleanup();
  });

  it("marks the command field as the flexible row item", () => {
    /* The send button must stay on the same line while the text field absorbs available width. */
    render(
      <TerminalTab
        activeId="demo"
        buffer=""
        input="ls"
        onInputChange={vi.fn()}
        onSend={vi.fn()}
      />
    );

    expect(screen.getByPlaceholderText("Type a command (e.g. ls)").className).toContain("terminal-input-field");
    expect(screen.getByRole("button", { name: "Send command" })).toBeTruthy();
  });
});
