/**
 * @fileoverview React entry point for Mini App.
 *
 * Exports:
 * - (none)
 *
 * Constructs:
 * - container (L22) - Root DOM mount element.
 */

import { createRoot } from "react-dom/client";

import { MiniAppRoot } from "./MiniAppRoot";
import { applyThemeToDocument, readStoredThemeMode } from "./utils/theme";
import "./styles.css";
import "./theme-layout.css";
import "./containers-layout.css";
import "./workspace-header.css";
import "./git-tab.css";
import "./providers-tab.css";
import "./skills-tab.css";
import "./skills-tab-states.css";
import "./skills-tab-responsive.css";
import "./miniapp-blocking-overlay.css";
import "./kanban.css";
import "./kanban-criteria.css";
import "./files-ui.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

/* Apply remembered theme before the first render to avoid route-specific flash. */
applyThemeToDocument(readStoredThemeMode());

createRoot(container).render(<MiniAppRoot />);
