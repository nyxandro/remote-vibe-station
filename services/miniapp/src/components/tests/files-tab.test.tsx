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
        fileList={{ rootPath: "/workspace/demo", path: "", entries: [] }}
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
        fileList={{ rootPath: "/workspace/demo", path: "src/components", entries: [] }}
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

  it("renders preview inside dedicated scrollable wrapper", () => {
    /* Wide code preview should stay constrained to tab width and scroll inside its own pane. */
    const { container } = render(
      <FilesTab
        activeId="demo"
        filePath="src"
        fileList={{ rootPath: "/workspace/demo", path: "src", entries: [] }}
        filePreview={{ path: "src/App.tsx", content: "const x = 1;" }}
        filePreviewHtml={'<pre class="shiki"><code>const x = 1;</code></pre>'}
        iconForEntry={() => <span />}
        onUp={vi.fn()}
        onRefresh={vi.fn()}
        onOpenEntry={vi.fn()}
      />
    );

    expect(screen.getByText("src/App.tsx")).toBeTruthy();
    expect(container.querySelector(".files-preview-body .codebox")).toBeTruthy();
  });
});
