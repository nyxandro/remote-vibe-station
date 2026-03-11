/**
 * @fileoverview UI tests for FilesTab navigation controls and layout.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilesTab } from "../FilesTab";

const renderFilesTab = (overrides?: Partial<ComponentProps<typeof FilesTab>>) => {
  const props: ComponentProps<typeof FilesTab> = {
    activeId: "demo",
    filePath: "src/components",
    fileList: { rootPath: "/workspace/demo", path: "src/components", entries: [] },
    filePreview: null,
    themeMode: "dark",
    iconForEntry: () => <span />,
    onUp: vi.fn(),
    onRefresh: vi.fn(),
    onOpenEntry: vi.fn(),
    onClosePreview: vi.fn(),
    onDownloadPreview: vi.fn(),
    onUploadFromDevice: vi.fn(),
    onImportFromUrl: vi.fn(),
    ...overrides
  };

  return {
    ...render(<FilesTab {...props} />),
    props
  };
};

describe("FilesTab", () => {
  afterEach(() => {
    /* Keep each test isolated to avoid leaked DOM state. */
    cleanup();
  });

  it("disables up button when current path is project root", () => {
    /* Root path must not allow navigating above the selected project folder. */
    renderFilesTab({ filePath: "", fileList: { rootPath: "/workspace/demo", path: "", entries: [] } });

    const upButton = screen.getByRole("button", { name: "Go up" }) as HTMLButtonElement;
    expect(upButton.disabled).toBe(true);
  });

  it("enables up button for nested folders", () => {
    /* Non-root path should keep parent navigation available. */
    renderFilesTab();

    const upButton = screen.getByRole("button", { name: "Go up" }) as HTMLButtonElement;
    expect(upButton.disabled).toBe(false);
  });

  it("shows current path on a dedicated strip and keeps toolbar buttons right-aligned order", () => {
    /* Path breadcrumbs should live on their own row while toolbar keeps only action buttons. */
    const { container } = renderFilesTab({ filePath: "sparkas_backend/public/uploads" });

    expect(container.querySelector(".files-location-strip")?.textContent).toContain("sparkas_backend/public/uploads");

    const toolbar = container.querySelector(".files-toolbar");
    expect(toolbar).toBeTruthy();

    const labels = within(toolbar as HTMLElement)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));

    expect(labels).toEqual(["Add file", "Refresh", "Go up"]);
  });

  it("opens upload modal from the add-file button", () => {
    /* File manager should expose upload entry point without leaving the current folder. */
    renderFilesTab();

    fireEvent.click(screen.getByRole("button", { name: "Add file" }));

    expect(screen.getByRole("dialog", { name: "Add file" })).toBeTruthy();
  });

  it("renders human-readable file sizes for files only", () => {
    /* Explorer rows should expose compact sizes without showing fake sizes for directories. */
    renderFilesTab({
      filePath: "docs",
      fileList: {
        rootPath: "/workspace/demo",
        path: "docs",
        entries: [
          { name: "guides", kind: "dir" },
          { name: "tiny.txt", kind: "file", sizeBytes: 999 },
          { name: "notes.md", kind: "file", sizeBytes: 1536 },
          { name: "spec.pdf", kind: "file", sizeBytes: 2_621_440 },
          { name: "archive.tar", kind: "file", sizeBytes: 3_221_225_472 }
        ]
      }
    });

    expect(screen.queryByText("guides")).toBeTruthy();
    expect(screen.queryByText("999 B")).toBeTruthy();
    expect(screen.queryByText("1.5 KB")).toBeTruthy();
    expect(screen.queryByText("2.5 MB")).toBeTruthy();
    expect(screen.queryByText("3 GB")).toBeTruthy();
  });
});
