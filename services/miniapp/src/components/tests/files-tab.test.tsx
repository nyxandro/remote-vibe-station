/**
 * @fileoverview UI tests for FilesTab navigation controls.
 */

/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilesTab } from "../FilesTab";

describe("FilesTab", () => {
  afterEach(() => {
    /* Keep each test isolated to avoid leaked DOM state. */
    cleanup();
  });

  it("disables up button when current path is project root", () => {
    /* Root path must not allow navigating above the selected project folder. */
    render(
      <FilesTab
        activeId="demo"
        filePath=""
        fileList={{ path: "", entries: [] }}
        filePreview={null}
        filePreviewHtml=""
        iconForEntry={() => <span />}
        onUp={vi.fn()}
        onRefresh={vi.fn()}
        onOpenEntry={vi.fn()}
      />
    );

    const upButton = screen.getByRole("button", { name: "Go up" }) as HTMLButtonElement;
    expect(upButton.disabled).toBe(true);
  });

  it("enables up button for nested folders", () => {
    /* Non-root path should keep parent navigation available. */
    render(
      <FilesTab
        activeId="demo"
        filePath="src/components"
        fileList={{ path: "src/components", entries: [] }}
        filePreview={null}
        filePreviewHtml=""
        iconForEntry={() => <span />}
        onUp={vi.fn()}
        onRefresh={vi.fn()}
        onOpenEntry={vi.fn()}
      />
    );

    const upButton = screen.getByRole("button", { name: "Go up" }) as HTMLButtonElement;
    expect(upButton.disabled).toBe(false);
  });
});
