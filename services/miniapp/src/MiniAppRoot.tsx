/**
 * @fileoverview Mini App root router for startapp deep-link screens.
 *
 * Exports:
 * - MiniAppRoot (L18) - Renders either main app or token-targeted diff preview.
 */

import { useMemo, useState } from "react";

import { App } from "./App";
import { DiffPreviewScreen } from "./components/DiffPreviewScreen";
import { readDiffPreviewToken } from "./utils/start-param";

export const MiniAppRoot = () => {
  const launchToken = useMemo(() => {
    /* Parse token only once from launch context. */
    return readDiffPreviewToken();
  }, []);
  const [activeToken, setActiveToken] = useState<string | null>(launchToken);

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
