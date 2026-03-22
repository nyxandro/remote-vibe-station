/**
 * @fileoverview Workspace project lifecycle and terminal action helpers.
 *
 * Exports:
 * - useWorkspaceRuntimeActions - Wraps container lifecycle actions and terminal input with shared refresh/error handling.
 */

import { useCallback } from "react";

import { apiPost } from "../api/client";
import { ContainerAction } from "../types";

type ComposeAction = ContainerAction;

export const useWorkspaceRuntimeActions = (input: {
  setError: (value: string | null) => void;
  terminalInput: string;
  setTerminalInput: (value: string) => void;
  loadProjects: () => Promise<void>;
  loadStatus: (projectId: string) => Promise<void>;
}) => {
  const { setError, terminalInput, setTerminalInput, loadProjects, loadStatus } = input;

  const runContainerAction = useCallback(
    async (projectId: string, service: string, action: ContainerAction): Promise<void> => {
      /* Service-level lifecycle actions refresh only the selected project status after success. */
      try {
        setError(null);
        await apiPost(
          `/api/projects/${encodeURIComponent(projectId)}/containers/${encodeURIComponent(service)}/${action}`,
          {}
        );
        await loadStatus(projectId);
      } catch (error) {
        setError(error instanceof Error ? error.message : `Failed to run container action: ${action}`);
      }
    },
    [loadStatus, setError]
  );

  const sendTerminal = useCallback(
    async (projectId: string): Promise<void> => {
      /* Terminal submit trims the payload and clears the draft only after backend confirmation. */
      const trimmed = terminalInput.trim();
      if (!trimmed) {
        return;
      }

      try {
        setError(null);
        await apiPost(`/api/projects/${encodeURIComponent(projectId)}/terminal/input`, { input: `${trimmed}\n` });
        setTerminalInput("");
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to send terminal input");
      }
    },
    [setError, setTerminalInput, terminalInput]
  );

  const runAction = useCallback(
    async (projectId: string, action: ComposeAction): Promise<void> => {
      /* Compose-wide actions refresh both the project catalog card and the focused status panel. */
      try {
        setError(null);
        await apiPost(`/api/projects/${encodeURIComponent(projectId)}/${encodeURIComponent(action)}`, {});
        await loadProjects();
        await loadStatus(projectId);
      } catch (error) {
        setError(error instanceof Error ? error.message : `Failed to run action: ${action}`);
      }
    },
    [loadProjects, loadStatus, setError]
  );

  return {
    runContainerAction,
    sendTerminal,
    runAction
  };
};
