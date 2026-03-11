/**
 * @fileoverview Tests for project file upload/import/download controller endpoints.
 *
 * Exports:
 * - none (Jest suite).
 */

import { BadRequestException, StreamableFile } from "@nestjs/common";
import { Response } from "express";

import { ProjectFilesController } from "../project-files.controller";

describe("ProjectFilesController", () => {
  const createController = () => {
    const projects = {
      getProjectRootPath: jest.fn(() => "/srv/projects/demo")
    };
    const files = {
      writeUploadedFile: jest.fn(() => ({ path: "public/logo.svg", name: "logo.svg", sizeBytes: 10 })),
      importFileFromUrl: jest.fn(async () => ({ path: "public/logo.svg", name: "logo.svg", sizeBytes: 10 })),
      readDownloadFile: jest.fn(() => ({ fileName: "logo.svg", content: Buffer.from("demo", "utf8") }))
    };

    return {
      controller: new ProjectFilesController(projects as never, files as never),
      projects,
      files
    };
  };

  test("uploadFromDevice rejects requests without a multipart file", async () => {
    /* Upload endpoint should fail fast when client submits metadata without file bytes. */
    const { controller } = createController();

    await expect(controller.uploadFromDevice("demo", { path: "public" }, undefined)).rejects.toThrow(BadRequestException);
  });

  test("importFromUrl rejects requests without URL", async () => {
    /* URL import must not continue when required external source is missing. */
    const { controller } = createController();

    await expect(controller.importFromUrl("demo", { path: "public" })).rejects.toThrow(BadRequestException);
  });

  test("download returns streamable file and attachment header", async () => {
    /* Download endpoint should set attachment headers so browser saves the selected file. */
    const { controller, files } = createController();
    const response = {
      setHeader: jest.fn()
    } as unknown as Response;

    const result = await controller.download("demo", "public/logo.svg", response);

    expect(files.readDownloadFile).toHaveBeenCalledWith("/srv/projects/demo", "public/logo.svg");
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      expect.stringContaining("filename*=UTF-8''logo.svg")
    );
    expect(result).toBeInstanceOf(StreamableFile);
  });
});
