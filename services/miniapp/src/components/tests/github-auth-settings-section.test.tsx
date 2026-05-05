/**
 * @fileoverview UI tests for GitHub global git-auth settings block.
 */

/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GitHubAuthSettingsSection } from "../GitHubAuthSettingsSection";

describe("GitHubAuthSettingsSection", () => {
  afterEach(() => {
    /* Keep each scenario isolated because the section renders inside details/summary accordions. */
    cleanup();
    vi.restoreAllMocks();
  });

  it("allows saving a PAT from settings", () => {
    /* Operators should be able to paste a token once and make git auth global for all projects. */
    const onDraftChange = vi.fn();
    const onSaveToken = vi.fn();

    render(
      <GitHubAuthSettingsSection
        status={{
          configured: true,
          connected: false,
          gitCredential: {
            connected: false,
            mode: "pat"
          }
        }}
        tokenDraft="github_pat_example"
        isLoading={false}
        isSaving={false}
        isDisconnecting={false}
        onReload={vi.fn()}
        onTokenDraftChange={onDraftChange}
        onSaveToken={onSaveToken}
        onDisconnect={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("8. GitHub для git"));
    fireEvent.change(screen.getByLabelText("GitHub personal access token"), {
      target: { value: "github_pat_next" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить token" }));

    expect(onDraftChange).toHaveBeenCalledTimes(1);
    expect(onSaveToken).toHaveBeenCalledTimes(1);
  });

  it("shows active global git auth state and allows disconnect", () => {
    /* Connected token should clearly show that agent git operations now use the stored PAT globally. */
    const onDisconnect = vi.fn();

    render(
      <GitHubAuthSettingsSection
        status={{
          configured: true,
          connected: true,
          tokenPreview: "gith...3456",
          updatedAt: "2026-03-10T08:00:00.000Z",
          gitCredential: {
            connected: true,
            mode: "pat",
            updatedAt: "2026-03-10T08:00:00.000Z"
          }
        }}
        tokenDraft=""
        isLoading={false}
        isSaving={false}
        isDisconnecting={false}
        onReload={vi.fn()}
        onTokenDraftChange={vi.fn()}
        onSaveToken={vi.fn()}
        onDisconnect={onDisconnect}
      />
    );

    fireEvent.click(screen.getByText("8. GitHub для git"));
    expect(screen.getByText(/Сохраненный token: gith...3456/i)).toBeTruthy();
    expect(screen.getByText(/Агент и git используют этот GitHub token глобально/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Отключить GitHub" }));
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("shows manual PAT instructions", () => {
    /* Self-hosted operators need concise token creation steps directly in the settings screen. */
    render(
      <GitHubAuthSettingsSection
        status={{
          configured: true,
          connected: false,
          gitCredential: {
            connected: false,
            mode: "pat"
          }
        }}
        tokenDraft=""
        isLoading={false}
        isSaving={false}
        isDisconnecting={false}
        onReload={vi.fn()}
        onTokenDraftChange={vi.fn()}
        onSaveToken={vi.fn()}
        onDisconnect={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("8. GitHub для git"));
    expect(screen.getByText(/Personal access tokens -> Fine-grained tokens/i)).toBeTruthy();
    expect(screen.getByText(/Contents: Read and write/i)).toBeTruthy();
  });
});
