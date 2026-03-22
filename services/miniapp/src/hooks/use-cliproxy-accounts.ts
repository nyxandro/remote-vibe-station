/**
 * @fileoverview Hook for CLIProxy account onboarding and status management.
 *
 * Exports:
 * - useCliproxyAccounts - Loads provider statuses and executes OAuth/account management actions.
 */

import { useCallback, useState } from "react";

import { apiDelete, apiGet, apiPost } from "../api/client";
import { CliproxyAccountState, CliproxyOAuthStartPayload, CliproxyProviderState } from "../types";

type OAuthCompletionInput = {
  provider: CliproxyProviderState["id"];
  callbackUrl?: string;
  code?: string;
  state?: string;
  error?: string;
};

type OnAccountsChanged = () => Promise<void> | void;

export const useCliproxyAccounts = (
  setError: (value: string | null) => void,
  onAccountsChanged?: OnAccountsChanged
) => {
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

  const refreshAfterAccountMutation = useCallback(
    async (shouldInvalidateProviders: boolean): Promise<void> => {
      /* Account mutations update the local list first and optionally fan out to provider summary badges. */
      await loadState();
      if (shouldInvalidateProviders && onAccountsChanged) {
        await onAccountsChanged();
      }
    },
    [loadState, onAccountsChanged]
  );

  const finalizeAccountMutation = useCallback(
    async (shouldInvalidateProviders: boolean, initialErrorMessage: string | null): Promise<void> => {
      /* Refresh failures should not clobber the original mutation error or leave the submit state stuck. */
      try {
        await refreshAfterAccountMutation(shouldInvalidateProviders);
      } catch (error) {
        if (!initialErrorMessage) {
          setError(error instanceof Error ? error.message : "Failed to refresh CLIProxy account state");
        }
      } finally {
        if (initialErrorMessage) {
          setError(initialErrorMessage);
        }
        setIsSubmitting(false);
      }
    },
    [refreshAfterAccountMutation, setError]
  );

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
      let initialErrorMessage: string | null = null;
      let shouldInvalidateProviders = false;

      try {
        setError(null);
        setIsSubmitting(true);
        await apiPost<{ ok: true }>("/api/telegram/cliproxy/oauth/complete", input);
        setOauthStart(null);
        shouldInvalidateProviders = true;
      } catch (error) {
        initialErrorMessage = error instanceof Error ? error.message : "Failed to complete CLIProxy OAuth flow";
        setError(initialErrorMessage);
      } finally {
        await finalizeAccountMutation(shouldInvalidateProviders, initialErrorMessage);
      }
    },
    [finalizeAccountMutation, setError]
  );

  const activateAccount = useCallback(
    async (accountId: string): Promise<void> => {
      /* Manual switch should persist in CLIProxy runtime and then refresh account state. */
      let initialErrorMessage: string | null = null;
      let shouldInvalidateProviders = false;

      try {
        setError(null);
        setIsSubmitting(true);
        await apiPost<{ ok: true }>(`/api/telegram/cliproxy/accounts/${encodeURIComponent(accountId)}/activate`, {});
        shouldInvalidateProviders = true;
      } catch (error) {
        initialErrorMessage = error instanceof Error ? error.message : "Failed to activate CLIProxy account";
        setError(initialErrorMessage);
      } finally {
        await finalizeAccountMutation(shouldInvalidateProviders, initialErrorMessage);
      }
    },
    [finalizeAccountMutation, setError]
  );

  const testAccount = useCallback(
    async (accountId: string): Promise<void> => {
      /* Manual test should refresh stale error/limit badges even when CLIProxy status lags behind reality. */
      let shouldInvalidateProviders = false;
      let initialErrorMessage: string | null = null;

      try {
        setError(null);
        setIsSubmitting(true);
        await apiPost<{ ok: true }>(`/api/telegram/cliproxy/accounts/${encodeURIComponent(accountId)}/test`, {});
        shouldInvalidateProviders = true;
      } catch (error) {
        initialErrorMessage = error instanceof Error ? error.message : "Failed to test CLIProxy account";
        setError(initialErrorMessage);
      } finally {
        await finalizeAccountMutation(shouldInvalidateProviders, initialErrorMessage);
      }
    },
    [finalizeAccountMutation, setError]
  );

  const deleteAccount = useCallback(
    async (accountId: string): Promise<void> => {
      /* Removing stale auth files should also refresh the list immediately after success. */
      let initialErrorMessage: string | null = null;
      let shouldInvalidateProviders = false;

      try {
        setError(null);
        setIsSubmitting(true);
        await apiDelete<{ ok: true }>(`/api/telegram/cliproxy/accounts/${encodeURIComponent(accountId)}`);
        shouldInvalidateProviders = true;
      } catch (error) {
        initialErrorMessage = error instanceof Error ? error.message : "Failed to delete CLIProxy account";
        setError(initialErrorMessage);
      } finally {
        await finalizeAccountMutation(shouldInvalidateProviders, initialErrorMessage);
      }
    },
    [finalizeAccountMutation, setError]
  );

  return {
    state,
    isLoading,
    isSubmitting,
    oauthStart,
    setOauthStart,
    loadState,
    startOAuth,
    completeOAuth,
    testAccount,
    activateAccount,
    deleteAccount
  };
};
