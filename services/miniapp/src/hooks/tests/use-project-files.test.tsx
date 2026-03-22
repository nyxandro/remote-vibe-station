/**
 * @fileoverview Tests for project file mutation invalidation behavior.
 *
 * Test suites:
 * - useProjectFiles - Verifies file mutations refresh explorer state and cross-tab git/project metadata.
 */

/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiGet, apiPost, apiPostFormData } from "../../api/client";
import { useProjectFiles } from "../use-project-files";

vi.mock("../../api/client", () => ({
  apiDownload: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPostFormData: vi.fn()
}));

const fileListResponse = {
  path: "src",
  entries: [{ name: "app.ts", path: "src/app.ts", kind: "file" as const, sizeBytes: 123 }]
};

describe("useProjectFiles", () => {
  beforeEach(() => {
    /* Reset network mocks so each test tracks one file mutation path. */
    vi.clearAllMocks();
  });

  it("invalidates git and project summary after a device upload succeeds", async () => {
    /* Uploading a file should immediately refresh repo-level change counters shown elsewhere in the app. */
    vi.mocked(apiPostFormData).mockResolvedValueOnce({ path: "src", name: "note.txt", sizeBytes: 12 });
    vi.mocked(apiGet).mockResolvedValueOnce(fileListResponse);
    const onFilesChanged = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectFiles(vi.fn(), onFilesChanged));

    await act(async () => {
      await result.current.uploadFileFromDevice("alpha", "src", new File(["hello"], "note.txt"));
    });

    expect(apiPostFormData).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith("/api/projects/alpha/files?path=src");
    expect(onFilesChanged).toHaveBeenCalledWith("alpha");
  });

  it("invalidates git and project summary after importing a file from url", async () => {
    /* URL import changes the working tree too, so GitHub and Projects must refresh immediately. */
    vi.mocked(apiPost).mockResolvedValueOnce({ path: "src", name: "remote.txt", sizeBytes: 44 });
    vi.mocked(apiGet).mockResolvedValueOnce(fileListResponse);
    const onFilesChanged = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() => useProjectFiles(vi.fn(), onFilesChanged));

    await act(async () => {
      await result.current.importFileFromUrl("alpha", "src", "https://example.com/remote.txt");
    });

    expect(apiPost).toHaveBeenCalledWith("/api/projects/alpha/files/import-url", {
      path: "src",
      url: "https://example.com/remote.txt"
    });
    expect(apiGet).toHaveBeenCalledWith("/api/projects/alpha/files?path=src");
    expect(onFilesChanged).toHaveBeenCalledWith("alpha");
  });
});
