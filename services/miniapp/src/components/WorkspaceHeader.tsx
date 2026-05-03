/**
 * @fileoverview Compact workspace header with active project actions and tabs.
 *
 * Exports:
 * - TabKey (L24) - Available workspace tabs.
 * - WorkspaceHeader (L46) - Renders top icon-tab bar and active project card.
 */

import {
  Box,
  FileText,
  Folder,
  Github,
  ListTodo,
  LucideIcon,
  Plug,
  Settings,
  Terminal
} from "lucide-react";

import { ProjectRecord } from "../types";

export type TabKey =
  | "projects"
  | "files"
  | "github"
  | "tasks"
  | "containers"
  | "providers"
  | "terminal"
  | "settings";

type Props = {
  activeProject: ProjectRecord | null;
  activeTab: TabKey;
  canUseProjectTabs: boolean;
  onSetTab: (tab: TabKey) => void;
};

const TAB_ITEMS: Array<{ key: TabKey; title: string; icon: LucideIcon }> = [
  { key: "projects", title: "Projects", icon: Folder },
  { key: "files", title: "Files", icon: FileText },
  { key: "github", title: "GitHub", icon: Github },
  { key: "tasks", title: "Tasks", icon: ListTodo },
  { key: "containers", title: "Containers", icon: Box },
  { key: "providers", title: "Providers", icon: Plug },
  { key: "terminal", title: "Terminal", icon: Terminal },
  { key: "settings", title: "Settings", icon: Settings }
];

export const WorkspaceHeader = (props: Props) => {
  return (
    <header className="workspace-header-shell">
      <nav className="workspace-top-tabs" aria-label="Workspace navigation">
        {TAB_ITEMS.map((tab) => {
          /* Keep icon tabs evenly distributed across the full width. */
          const Icon = tab.icon;
          const isActive = props.activeTab === tab.key;
          const disabled =
            tab.key !== "projects" &&
            tab.key !== "providers" &&
            tab.key !== "settings" &&
            !props.canUseProjectTabs;

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
        </section>
      ) : (
        <section className="active-project-card active-project-card-empty">
          <span className="active-project-hint">Select a project to unlock Files/GitHub/Tasks/Terminal/Containers.</span>
        </section>
      )}
    </header>
  );
};
