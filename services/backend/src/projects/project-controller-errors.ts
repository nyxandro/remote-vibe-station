/**
 * @fileoverview Structured error helpers for ProjectsController HTTP endpoints.
 *
 * Exports:
 * - createProjectsControllerBadRequest - Wraps normalized app-error payload into BadRequestException.
 * - projectPayloadInvalidError - Invalid create/register payload error.
 * - projectNameRequiredError - Missing project name error.
 * - repositoryUrlRequiredError - Missing repository URL error.
* - unsupportedContainerActionError - Invalid container lifecycle action error.
 * - filePathRequiredError - Missing project file path error.
 * - terminalInputRequiredError - Missing terminal input error.
 * - branchRequiredError - Missing git branch error.
 * - sourceBranchRequiredError - Missing git merge source branch error.
 * - commitMessageRequiredError - Missing git commit message error.
 */

import { BadRequestException } from "@nestjs/common";

import { createAppErrorBody, normalizeUnknownErrorToAppError } from "../logging/app-error";

export const createProjectsControllerBadRequest = (input: {
  error: unknown;
  fallbackCode: string;
  fallbackMessage: string;
  fallbackHint: string;
}): BadRequestException => {
  /* Controller catch blocks reuse one helper so project endpoints expose consistent error metadata. */
  return new BadRequestException(
    normalizeUnknownErrorToAppError({
      error: input.error,
      fallbackCode: input.fallbackCode,
      fallbackMessage: input.fallbackMessage,
      fallbackHint: input.fallbackHint
    })
  );
};

export const projectPayloadInvalidError = (): BadRequestException => {
  /* Project create/register payload must include the minimal compose/runtime fields. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_PROJECT_PAYLOAD_INVALID",
      message: "Project payload is invalid.",
      hint: "Provide project name, slug, root path, compose path, service name and service port."
    })
  );
};

export const projectNameRequiredError = (): BadRequestException => {
  /* Empty folder names are rejected before any filesystem operation starts. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_PROJECT_NAME_REQUIRED",
      message: "Project name is required.",
      hint: "Enter a non-empty project name and retry folder creation."
    })
  );
};

export const repositoryUrlRequiredError = (): BadRequestException => {
  /* Clone flow needs an explicit repository URL and should fail fast when it is missing. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_PROJECT_REPOSITORY_URL_REQUIRED",
      message: "Repository URL is required.",
      hint: "Provide a git repository URL and retry the clone operation."
    })
  );
};

export const unsupportedContainerActionError = (action: string): BadRequestException => {
  /* Only the supported lifecycle verbs may be routed to compose service actions. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_PROJECT_CONTAINER_ACTION_UNSUPPORTED",
      message: `Container action '${action}' is not supported.`,
      hint: "Use one of: start, stop or restart."
    })
  );
};

export const filePathRequiredError = (): BadRequestException => {
  /* File preview endpoint must never guess the path to read from the project tree. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_PROJECT_FILE_PATH_REQUIRED",
      message: "Project file path is required.",
      hint: "Select a file path from the project tree and retry the preview request."
    })
  );
};

export const terminalInputRequiredError = (): BadRequestException => {
  /* Terminal session input stays explicit so empty requests do not spawn meaningless writes. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_PROJECT_TERMINAL_INPUT_REQUIRED",
      message: "Terminal input is required.",
      hint: "Provide non-empty terminal input text and retry the request."
    })
  );
};

export const branchRequiredError = (): BadRequestException => {
  /* Checkout flow must know the target branch before calling git. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_PROJECT_GIT_BRANCH_REQUIRED",
      message: "Git branch is required.",
      hint: "Provide a branch name and retry the checkout request."
    })
  );
};

export const sourceBranchRequiredError = (): BadRequestException => {
  /* Merge flow must know which source branch should be merged into the current branch. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_PROJECT_GIT_SOURCE_BRANCH_REQUIRED",
      message: "Git source branch is required.",
      hint: "Provide the source branch name and retry the merge request."
    })
  );
};

export const commitMessageRequiredError = (): BadRequestException => {
  /* Commit flow needs a real commit message before mutating repository history. */
  return new BadRequestException(
    createAppErrorBody({
      code: "APP_PROJECT_GIT_COMMIT_MESSAGE_REQUIRED",
      message: "Commit message is required.",
      hint: "Provide a non-empty commit message and retry the commit request."
    })
  );
};
