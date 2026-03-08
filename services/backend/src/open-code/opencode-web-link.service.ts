/**
 * @fileoverview Resolves browser deep-links for the current OpenCode project session.
 *
 * Exports:
 * - OpenCodeCurrentSessionLink (L20) - Deep-link payload used by Telegram /access.
 * - OpenCodeWebLinkService (L30) - Builds same-origin OpenCode UI path for current admin session.
 */

import { Inject, Injectable } from "@nestjs/common";

import { AppConfig, ConfigToken } from "../config/config.types";
import { ProjectsService } from "../projects/projects.service";
import { OpenCodeClient } from "./opencode-client";

const OPENCODE_PROJECT_ID_REGEX = /^[0-9a-f]{40}$/i;
const OPENCODE_REQUEST_TIMEOUT_MS = 10_000;

export type OpenCodeCurrentSessionLink = {
  projectSlug: string;
  sessionID: string;
  redirectPath: string;
};

@Injectable()
export class OpenCodeWebLinkService {
  public constructor(
    @Inject(ConfigToken) private readonly config: AppConfig,
    private readonly projects: ProjectsService,
    private readonly opencode: OpenCodeClient
  ) {}

  public async getCurrentSessionLink(adminId: number): Promise<OpenCodeCurrentSessionLink | null> {
    /* Deep-link is available only when both active project and selected OpenCode session are known. */
    const activeProject = await this.projects.getActiveProject(adminId);
    if (!activeProject) {
      return null;
    }

    const sessionID = this.opencode.getSelectedSessionID(activeProject.rootPath);
    if (!sessionID) {
      return null;
    }

    /* Resolve the internal OpenCode project id bound to the exact git worktree. */
    const projectID = await this.resolveProjectID(activeProject.rootPath);
    if (!projectID) {
      return null;
    }

    return {
      projectSlug: activeProject.slug,
      sessionID,
      redirectPath: `/project/${encodeURIComponent(projectID)}/session/${encodeURIComponent(sessionID)}`
    };
  }

  private async resolveProjectID(directory: string): Promise<string | null> {
    /* OpenCode stores projects separately from sessions, so derive the canonical hashed project id first. */
    const projects = await this.request<Array<{ id?: string; worktree?: string }>>(
      `/project?directory=${encodeURIComponent(directory)}`,
      { method: "GET" }
    );

    const exactProject = (Array.isArray(projects) ? projects : []).find((item) => {
      const projectID = String(item?.id ?? "").trim();
      const worktree = String(item?.worktree ?? "").trim();
      return worktree === directory && OPENCODE_PROJECT_ID_REGEX.test(projectID);
    });

    if (!exactProject?.id) {
      return null;
    }

    return exactProject.id;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    /* Mirror OpenCode basic-auth handling so project lookup works in protected deployments too. */
    const url = `${this.config.opencodeServerUrl}${path}`;
    const headers = new Headers(init.headers);
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), OPENCODE_REQUEST_TIMEOUT_MS);

    /* Keep credentials explicit because OpenCode project lookup uses the same internal API as prompt traffic. */
    if (this.config.opencodeServerPassword && this.config.opencodeServerUsername) {
      const credentials = `${this.config.opencodeServerUsername}:${this.config.opencodeServerPassword}`;
      headers.set("Authorization", `Basic ${Buffer.from(credentials).toString("base64")}`);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers,
        signal: abortController.signal
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`OpenCode request failed for ${path}: ${message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`OpenCode request failed for ${path}: ${response.status} ${bodyText}`);
    }

    /* Parse JSON explicitly so malformed upstream payloads point to the exact API call. */
    try {
      return JSON.parse(bodyText) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`OpenCode JSON parse failed for ${path}: ${message}; body=${bodyText}`);
    }
  }
}
