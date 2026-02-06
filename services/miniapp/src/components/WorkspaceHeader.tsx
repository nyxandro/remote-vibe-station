/**
 * @fileoverview Compact workspace header with active project actions and tabs.
 *
 * Exports:
 * - TabKey (L13) - Available workspace tabs.
 * - WorkspaceHeader (L49) - Renders top icon-tab bar and active project card.
 */

import {
  Box,
  FileText,
  Folder,
  Github,
  Radio,
  RadioTower,
  Settings,
  Terminal
} from "lucide-react";
import { ComponentType } from "react";

import { ProjectRecord } from "../types";

export type TabKey = "projects" | "files" | "github" | "terminal" | "containers" | "settings";

type Props = {
  activeProject: ProjectRecord | null;
  activeTab: TabKey;
  canUseProjectTabs: boolean;
  canControlTelegramStream: boolean;
  telegramStreamEnabled: boolean;
  onSetTab: (tab: TabKey) => void;
  onStartStream: () => void;
  onStopStream: () => void;
};

const TAB_ITEMS: Array<{ key: TabKey; title: string; icon: ComponentType<{ size?: number }> }> = [
  { key: "projects", title: "Projects", icon: Folder },
  { key: "files", title: "Files", icon: FileText },
  { key: "github", title: "GitHub", icon: Github },
  { key: "terminal", title: "Terminal", icon: Terminal },
  { key: "containers", title: "Containers", icon: Box },
  { key: "settings", title: "Settings", icon: Settings }
];

export const WorkspaceHeader = (props: Props) => {
  /* Keep stream controls near the active project context to reduce scanning. */
  const streamTitle = props.canControlTelegramStream
    ? props.telegramStreamEnabled
      ? "Stop streaming to Telegram"
      : "Start streaming to Telegram"
    : "Open the Mini App inside Telegram or via the /open link (with token)";

  return (
    <header className="workspace-header-shell">
      <nav className="workspace-top-tabs" aria-label="Workspace navigation">
        {TAB_ITEMS.map((tab) => {
          /* Keep 5 equal icon tabs across the full width. */
          const Icon = tab.icon;
          const isActive = props.activeTab === tab.key;
          const disabled = tab.key !== "projects" && tab.key !== "settings" && !props.canUseProjectTabs;

          return (
            <button
              key={tab.key}
              className={isActive ? "workspace-icon-tab active" : "workspace-icon-tab"}
              disabled={disabled}
              onClick={() => props.onSetTab(tab.key)}
              type="button"
              title={tab.title}
              aria-label={tab.title}
            >
              <Icon size={18} />
            </button>
          );
        })}
      </nav>

      {props.activeProject ? (
        <section className="active-project-card">
          <div className="active-project-content">
            <span className="active-project-name">{props.activeProject.name}</span>
            <span className="active-project-path">{props.activeProject.rootPath}</span>
          </div>

          <button
            className={props.telegramStreamEnabled ? "stream-toggle stream-toggle-on" : "stream-toggle"}
            disabled={!props.canControlTelegramStream}
            onClick={props.telegramStreamEnabled ? props.onStopStream : props.onStartStream}
            title={streamTitle}
            type="button"
            aria-label={props.telegramStreamEnabled ? "Stop stream" : "Start stream"}
          >
            {props.telegramStreamEnabled ? <RadioTower size={20} /> : <Radio size={20} />}
          </button>
        </section>
      ) : (
        <section className="active-project-card active-project-card-empty">
          <span className="active-project-hint">Select a project to unlock Files/GitHub/Terminal/Containers.</span>
        </section>
      )}
    </header>
  );
};
