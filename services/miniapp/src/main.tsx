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
import "./styles.css";
import "./theme-layout.css";
import "./containers-layout.css";
import "./workspace-header.css";
import "./git-tab.css";
import "./providers-tab.css";
import "./miniapp-blocking-overlay.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

createRoot(container).render(<MiniAppRoot />);
