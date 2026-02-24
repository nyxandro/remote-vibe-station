/**
 * @fileoverview Provider onboarding state/actions for Mini App Providers tab.
 *
 * Exports:
 * - ProviderOAuthState (L16) - In-progress OAuth handoff payload and local draft code.
 * - useProviderAuth (L29) - Loads provider overview and executes connect/disconnect actions.
 */

import { useCallback, useState } from "react";

import { apiGet, apiPost } from "../api/client";
import { ProviderOverview } from "../types";

export type ProviderOAuthState = {
  providerID: string;
  methodIndex: number;
  method: "auto" | "code";
  url: string;
  instructions: string;
  codeDraft: string;
};

export const useProviderAuth = (setError: (value: string | null) => void) => {
  const [overview, setOverview] = useState<ProviderOverview | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [oauthState, setOAuthState] = useState<ProviderOAuthState | null>(null);

  const loadOverview = useCallback(async (): Promise<void> => {
    /* Refresh provider status, selected mode and auth methods for Providers tab. */
    try {
      setError(null);
      setIsLoading(true);
      const data = await apiGet<ProviderOverview>("/api/telegram/providers");
      setOverview(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to load providers");
    } finally {
      setIsLoading(false);
    }
  }, [setError]);

  const startConnect = useCallback(
    async (input: { providerID: string; methodIndex: number }): Promise<void> => {
      /* Resolve selected method and branch into OAuth or API-key flow. */
      if (isSubmitting) {
        return;
      }

      const methods = overview?.authMethods?.[input.providerID] ?? [];
      const selected = methods[input.methodIndex];
      if (!selected) {
        setError("Method not found");
        return;
      }

      if (selected.type === "api") {
        setOAuthState({
          providerID: input.providerID,
          methodIndex: input.methodIndex,
          method: "code",
          url: "",
          instructions: "api",
          codeDraft: ""
        });
        return;
      }

      try {
        setError(null);
        setIsSubmitting(true);
        const response = await apiPost<{
          ok: true;
          url: string;
          method: "auto" | "code";
          instructions: string;
        }>("/api/telegram/providers/oauth/authorize", {
          providerID: input.providerID,
          method: input.methodIndex
        });

        setOAuthState({
          providerID: input.providerID,
          methodIndex: input.methodIndex,
          method: response.method,
          url: response.url,
          instructions: response.instructions,
          codeDraft: ""
        });
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to start OAuth flow");
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, overview, setError]
  );

  const submitApiKey = useCallback(
    async (input: { providerID: string; key: string }): Promise<void> => {
      /* Persist API key auth method and refresh providers snapshot. */
      if (isSubmitting) {
        return;
      }

      try {
        setError(null);
        setIsSubmitting(true);
        await apiPost<{ ok: true }>("/api/telegram/providers/api-key", input);
        setOAuthState(null);
        await loadOverview();
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to save API key");
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, loadOverview, setError]
  );

  const completeOAuthAuto = useCallback(async (): Promise<void> => {
    /* Finalize OAuth auto mode after user completes browser consent page. */
    if (isSubmitting) {
      return;
    }

    if (!oauthState) {
      return;
    }

    try {
      setError(null);
      setIsSubmitting(true);
      await apiPost<{ ok: true }>("/api/telegram/providers/oauth/callback", {
        providerID: oauthState.providerID,
        method: oauthState.methodIndex
      });
      setOAuthState(null);
      await loadOverview();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to complete OAuth");
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, loadOverview, oauthState, setError]);

  const submitOAuthCode = useCallback(async (): Promise<void> => {
    /* Submit manually copied OAuth code for providers requiring code callback. */
    if (isSubmitting) {
      return;
    }

    if (!oauthState) {
      return;
    }

    const code = oauthState.codeDraft.trim();
    if (!code) {
      setError("OAuth code is required");
      return;
    }

    try {
      setError(null);
      setIsSubmitting(true);
      await apiPost<{ ok: true }>("/api/telegram/providers/oauth/callback", {
        providerID: oauthState.providerID,
        method: oauthState.methodIndex,
        code
      });
      setOAuthState(null);
      await loadOverview();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to complete OAuth code flow");
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, loadOverview, oauthState, setError]);

  const disconnect = useCallback(
    async (providerID: string): Promise<void> => {
      /* Disconnect provider credentials and refresh connectivity markers. */
      if (isSubmitting) {
        return;
      }

      try {
        setError(null);
        setIsSubmitting(true);
        await apiPost<{ ok: true }>("/api/telegram/providers/disconnect", { providerID });
        setOAuthState(null);
        await loadOverview();
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to disconnect provider");
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, loadOverview, setError]
  );

  return {
    overview,
    isLoading,
    isSubmitting,
    oauthState,
    setOAuthState,
    loadOverview,
    startConnect,
    submitApiKey,
    completeOAuthAuto,
    submitOAuthCode,
    disconnect
  };
};
