/**
 * @fileoverview UI tests for fullscreen file preview modal actions.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilePreviewModal } from "../FilePreviewModal";

describe("FilePreviewModal", () => {
  afterEach(() => {
    /* Prevent modal DOM from leaking across tests. */
    cleanup();
  });

  it("renders fullscreen preview with download and close actions", () => {
    /* Preview modal should expose the same fullscreen reading surface plus download action. */
    const onDownload = vi.fn();
    const onClose = vi.fn();

    render(
      <FilePreviewModal
        isOpen
        themeMode="dark"
        filePath="public/uploads/debug_images.js"
        content="console.log('hello');"
        onClose={onClose}
        onDownload={onDownload}
      />
    );

    expect(screen.getByText("public/uploads/debug_images.js")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Download file" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
