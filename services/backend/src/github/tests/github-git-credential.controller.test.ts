/**
 * @fileoverview HTTP-level tests for internal GitHub git-credential endpoint.
 *
 * Exports:
 * - (none)
 */

import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { ConfigToken } from "../../config/config.types";
import { BotBackendGuard } from "../../security/bot-backend.guard";
import { GithubGitCredentialController } from "../github-git-credential.controller";
import { GithubAppService } from "../github-app.service";

describe("GithubGitCredentialController", () => {
  let app: INestApplication;
  let github: { createGitCredential: jest.Mock };

  beforeEach(async () => {
    /* Keep internal credential route isolated while exercising the real shared-token guard. */
    github = {
      createGitCredential: jest.fn().mockResolvedValue({
        username: "git",
        password: "github_pat_example123",
        mode: "pat",
        updatedAt: "2026-01-01T11:00:00.000Z"
      })
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [GithubGitCredentialController],
      providers: [
        BotBackendGuard,
        {
          provide: ConfigToken,
          useValue: {
            botBackendAuthToken: "secret-token"
          }
        },
        { provide: GithubAppService, useValue: github }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);
  });

  afterEach(async () => {
    /* Always close listeners so fetch-based tests never leak ports between cases. */
    await app.close();
  });

  test("returns credential payload for trusted internal caller", async () => {
    /* Backend/opencode helper should receive username/password pair without Telegram app auth. */
    const response = await fetch(`${await app.getUrl()}/api/internal/github/git-credential`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bot-backend-token": "secret-token"
      },
      body: JSON.stringify({ protocol: "https", host: "github.com", path: "nyxandro/repo.git" })
    });

    expect(response.status).toBe(201);
    expect(github.createGitCredential).toHaveBeenCalledWith({
      protocol: "https",
      host: "github.com",
      path: "nyxandro/repo.git"
    });
  });

  test("rejects requests without shared backend token", async () => {
    /* Public callers must never reach the internal credential minting endpoint. */
    const response = await fetch(`${await app.getUrl()}/api/internal/github/git-credential`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ protocol: "https", host: "github.com" })
    });

    expect(response.status).toBe(401);
    expect(github.createGitCredential).not.toHaveBeenCalled();
  });
});
