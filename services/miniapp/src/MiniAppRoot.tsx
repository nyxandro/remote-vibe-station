/**
 * @fileoverview Mini App root router for startapp deep-link screens.
 *
 * Exports:
 * - MiniAppRoot (L20) - Renders either main app or token-targeted diff preview.
 */

import { useMemo, useState } from "react";

import { App } from "./App";
import { KanbanBoardScreen } from "./components/KanbanBoardScreen";
import { MiniAppBlockingOverlay } from "./components/MiniAppBlockingOverlay";
import { DiffPreviewScreen } from "./components/DiffPreviewScreen";
import { useMiniAppReadiness } from "./hooks/use-miniapp-readiness";
import { useTelegramWebApp } from "./hooks/use-telegram-webapp";
import { readKanbanProjectFilter, readLaunchView } from "./utils/launch-view";
import { readDiffPreviewToken } from "./utils/start-param";

export const MiniAppRoot = () => {
  useTelegramWebApp();
  const readiness = useMiniAppReadiness();
  const launchToken = useMemo(() => {
    /* Parse token only once from launch context. */
    return readDiffPreviewToken();
  }, []);
  const launchView = useMemo(() => readLaunchView(), []);
  const kanbanProjectFilter = useMemo(() => readKanbanProjectFilter(), []);
  const [activeToken, setActiveToken] = useState<string | null>(launchToken);

  if (!readiness.isReady) {
    /* Keep UI fully blocked until backend connectivity is restored. */
    return (
      <MiniAppBlockingOverlay
        isChecking={readiness.isChecking}
        blockReason={readiness.blockReason}
        onRetry={readiness.retryNow}
      />
    );
  }

  if (activeToken) {
    return (
      <DiffPreviewScreen
        token={activeToken}
        onClose={() => {
          /* Return to standard Mini App workspace screen. */
          setActiveToken(null);
        }}
      />
    );
  }

  if (launchView === "kanban") {
    return <KanbanBoardScreen initialProjectSlug={kanbanProjectFilter} />;
  }

  return <App />;
};
