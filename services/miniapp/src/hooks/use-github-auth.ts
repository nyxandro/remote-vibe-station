/**
 * @fileoverview Hook for global GitHub PAT management.
 *
 * Exports:
 * - GithubAuthState - UI state for GitHub PAT save/disconnect controls.
 * - useGithubAuth - Loads GitHub token status and runs save/disconnect mutations via backend API.
 */

import { useCallback, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import { GithubAuthStatus } from "../types";

export type GithubAuthState = {
  status: GithubAuthStatus | null;
  tokenDraft: string;
  isLoading: boolean;
  isSaving: boolean;
  isDisconnecting: boolean;
};

export const useGithubAuth = (setError: (value: string | null) => void) => {
  const [state, setState] = useState<GithubAuthState>({
    status: null,
    tokenDraft: "",
    isLoading: false,
    isSaving: false,
    isDisconnecting: false
  });

  const loadStatus = useCallback(async (): Promise<void> => {
    /* Settings screen must reflect the current instance-wide GitHub PAT state. */
    try {
      setError(null);
      setState((prev) => ({ ...prev, isLoading: true }));
      const status = await apiGet<GithubAuthStatus>("/api/telegram/github/status");
      setState((prev) => ({ ...prev, status, isLoading: false }));
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
      setError(error instanceof Error ? error.message : "Failed to load GitHub status");
    }
  }, [setError]);

  const setTokenDraft = useCallback((value: string): void => {
    /* Keep PAT draft local to the settings form until the user explicitly saves it. */
    setState((prev) => ({ ...prev, tokenDraft: value }));
  }, []);

  const saveToken = useCallback(async (): Promise<void> => {
    /* Saving a PAT should immediately refresh the shared git-auth status shown in settings. */
    try {
      setError(null);
      setState((prev) => ({ ...prev, isSaving: true }));
      await apiPost<{ ok: true }>("/api/telegram/github/token", { token: state.tokenDraft });
      const status = await apiGet<GithubAuthStatus>("/api/telegram/github/status");
      setState((prev) => ({ ...prev, status, tokenDraft: "", isSaving: false }));
    } catch (error) {
      setState((prev) => ({ ...prev, isSaving: false }));
      setError(error instanceof Error ? error.message : "Failed to save GitHub token");
    }
  }, [setError, state.tokenDraft]);

  const disconnect = useCallback(async (): Promise<void> => {
    /* Disconnect removes the stored PAT and disables future git auth until a new token is saved. */
    try {
      setError(null);
      setState((prev) => ({ ...prev, isDisconnecting: true }));
      await apiPost<{ ok: true }>("/api/telegram/github/disconnect", {});
      const status = await apiGet<GithubAuthStatus>("/api/telegram/github/status");
      setState((prev) => ({ ...prev, status, isDisconnecting: false }));
    } catch (error) {
      setState((prev) => ({ ...prev, isDisconnecting: false }));
      setError(error instanceof Error ? error.message : "Failed to disconnect GitHub");
    }
  }, [setError]);

  return {
    state,
    loadStatus,
    setTokenDraft,
    saveToken,
    disconnect
  };
};
