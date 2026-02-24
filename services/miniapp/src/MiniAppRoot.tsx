/**
 * @fileoverview Mini App root router for startapp deep-link screens.
 *
 * Exports:
 * - MiniAppRoot (L20) - Renders either main app or token-targeted diff preview.
 */

import { useMemo, useState } from "react";

import { App } from "./App";
import { MiniAppBlockingOverlay } from "./components/MiniAppBlockingOverlay";
import { DiffPreviewScreen } from "./components/DiffPreviewScreen";
import { useMiniAppReadiness } from "./hooks/use-miniapp-readiness";
import { readDiffPreviewToken } from "./utils/start-param";

export const MiniAppRoot = () => {
  const readiness = useMiniAppReadiness();
  const launchToken = useMemo(() => {
    /* Parse token only once from launch context. */
    return readDiffPreviewToken();
  }, []);
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

  return <App />;
};
