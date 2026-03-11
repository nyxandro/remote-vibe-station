/**
 * @fileoverview UI tests for file upload/import modal flows.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileUploadModal } from "../FileUploadModal";

describe("FileUploadModal", () => {
  afterEach(() => {
    /* Keep dialog tests isolated so tab state does not leak across cases. */
    cleanup();
  });

  it("uploads a selected local file into the current folder", async () => {
    /* Local device upload should pass the selected file object without extra translation. */
    const onUploadFile = vi.fn(async () => undefined);
    const file = new File(["hello world"], "hello.txt", { type: "text/plain" });

    render(
      <FileUploadModal
        isOpen
        currentPath="public/uploads"
        onClose={vi.fn()}
        onUploadFile={onUploadFile}
        onImportFromUrl={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Choose file from device"), {
      target: { files: [file] }
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));

    await waitFor(() => {
      expect(onUploadFile).toHaveBeenCalledWith(file);
    });
  });

  it("imports a file by external URL", async () => {
    /* URL mode should submit the raw external link so backend can download it into the active folder. */
    const onImportFromUrl = vi.fn(async () => undefined);

    render(
      <FileUploadModal
        isOpen
        currentPath="public/uploads"
        onClose={vi.fn()}
        onUploadFile={vi.fn()}
        onImportFromUrl={onImportFromUrl}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "From link" }));
    fireEvent.change(screen.getByLabelText("File URL"), {
      target: { value: "https://example.com/assets/logo.svg" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Import file" }));

    await waitFor(() => {
      expect(onImportFromUrl).toHaveBeenCalledWith("https://example.com/assets/logo.svg");
    });
  });
});
