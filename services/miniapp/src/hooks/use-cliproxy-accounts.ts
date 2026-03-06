/**
 * @fileoverview Hook for CLIProxy account onboarding and status management.
 *
 * Exports:
 * - useCliproxyAccounts - Loads provider statuses and executes OAuth start/callback.
 */

import { useCallback, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import { CliproxyAccountState, CliproxyOAuthStartPayload, CliproxyProviderState } from "../types";

type OAuthCompletionInput = {
  provider: CliproxyProviderState["id"];
  callbackUrl?: string;
  code?: string;
  state?: string;
  error?: string;
};

export const useCliproxyAccounts = (setError: (value: string | null) => void) => {
  const [state, setState] = useState<CliproxyAccountState | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [oauthStart, setOauthStart] = useState<CliproxyOAuthStartPayload | null>(null);

  const loadState = useCallback(async (): Promise<void> => {
    /* UI should always show real provider statuses from CLIProxy management API. */
    try {
      setError(null);
      setIsLoading(true);
      const data = await apiGet<CliproxyAccountState>("/api/telegram/cliproxy/state");
      setState(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load CLIProxy account state");
    } finally {
      setIsLoading(false);
    }
  }, [setError]);

  const startOAuth = useCallback(
    async (provider: CliproxyProviderState["id"]): Promise<void> => {
      /* Start selected provider login flow and keep URL/state for follow-up callback step. */
      try {
        setError(null);
        setIsSubmitting(true);
        const payload = await apiPost<CliproxyOAuthStartPayload>("/api/telegram/cliproxy/oauth/start", {
          provider
        });
        setOauthStart(payload);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to start CLIProxy OAuth flow");
      } finally {
        setIsSubmitting(false);
      }
    },
    [setError]
  );

  const completeOAuth = useCallback(
    async (input: OAuthCompletionInput): Promise<void> => {
      /* Complete flow from pasted callback URL or explicit code/state pair. */
      try {
        setError(null);
        setIsSubmitting(true);
        await apiPost<{ ok: true }>("/api/telegram/cliproxy/oauth/complete", input);
        setOauthStart(null);
        await loadState();
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to complete CLIProxy OAuth flow");
      } finally {
        setIsSubmitting(false);
      }
    },
    [loadState, setError]
  );

  return {
    state,
    isLoading,
    isSubmitting,
    oauthStart,
    setOauthStart,
    loadState,
    startOAuth,
    completeOAuth
  };
};
