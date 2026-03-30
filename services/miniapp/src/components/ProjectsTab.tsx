/**
 * @fileoverview Projects tab UI.
 *
 * Exports:
 * - ProjectsTab (L22) - Renders project search, actions, and stream indicator.
 */

import { ChangeEvent, useState } from "react";
import { Container, GitCommitHorizontal, Plus } from "lucide-react";

import { ProjectAddModal } from "./ProjectAddModal";
import { ProjectGitSummary, ProjectRecord, ProjectStatus } from "../types";
import { deriveProjectContainerHealth } from "../utils/project-container-health";

const formatDeployRouteLabel = (route: NonNullable<ProjectRecord["deploy"]>["routes"][number]): string => {
  /* Surface stable route ids like web/admin/api because operators recognize them faster than raw hosts. */
  const normalized = route.id.trim().toLowerCase();
  return normalized.length > 0 ? normalized : "open";
};

const formatDeployRouteHost = (previewUrl: string): string => {
  /* Keep card copy compact by showing host/path instead of repeated protocol noise. */
  try {
    const parsed = new URL(previewUrl);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return previewUrl;
  }
};

type Props = {
  visibleProjects: ProjectRecord[];
  activeId: string | null;
  query: string;
  telegramStreamEnabled: boolean;
  statusMap: Record<string, ProjectStatus[] | undefined>;
  gitSummaryMap: Record<string, ProjectGitSummary | null | undefined>;
  onQueryChange: (value: string) => void;
  onSelectProject: (projectId: string) => void;
  onDeployProject: (projectId: string) => void;
  onStopProjectDeploy: (projectId: string) => void;
  onCreateProjectFolder: (name: string) => Promise<void> | void;
  onCloneRepository: (repositoryUrl: string, folderName?: string) => Promise<void> | void;
};

export const ProjectsTab = (props: Props) => {
  /* Projects list keeps only local view state; add-project inputs now live in a dedicated modal component. */
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  const toggleCardExpansion = (id: string) => {
    setExpandedCardId((prev) => (prev === id ? null : id));
  };

  return (
    <>
      <div className="panel-toolbar">
        <input
          className="input project-search-input"
          placeholder="Search projects…"
          value={props.query}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            props.onQueryChange(e.target.value)
          }
        />

        <div className="project-create-menu-shell">
          <button
            className="btn outline project-create-btn"
            onClick={() => setIsAddModalOpen(true)}
            type="button"
            aria-label="Create project"
          >
            <Plus size={16} />
          </button>
        </div>
      </div>

      <ProjectAddModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onCreateProjectFolder={props.onCreateProjectFolder}
        onCloneRepository={props.onCloneRepository}
      />

      <div className="project-grid">
        {props.visibleProjects.map((project) => {
          const isActive = project.id === props.activeId;
          const showStream = isActive && props.telegramStreamEnabled;
          const health = deriveProjectContainerHealth(
            props.statusMap[project.id],
          );
          const healthClass = health
            ? `project-health project-health-${health.level}`
            : undefined;
          const gitSummary = props.gitSummaryMap[project.id] ?? null;
          const isExpanded = expandedCardId === project.id;
          const isDeployed = project.status === "running";
          const deployRoutes = project.deploy?.routes ?? [];

          return (
            <article
              key={project.id}
              className={isActive ? "project-card active" : "project-card"}
              onClick={() => toggleCardExpansion(project.id)}
              style={{ cursor: "pointer" }}
            >
              <div className="project-meta">
                <div className="project-top">
                  <div className="project-name-row">
                    <div className="project-name">{project.name}</div>
                    {showStream ? (
                      <span
                        className="stream-pill"
                        title="Streaming to Telegram"
                      >
                        <span className="stream-dot" />
                        STREAM
                      </span>
                    ) : null}
                  </div>

                  {health ? (
                    <span
                      className={healthClass}
                      aria-label={`Containers ${health.countLabel}`}
                    >
                      <Container size={13} />
                      {health.countLabel}
                    </span>
                  ) : null}
                </div>
                <div className="project-path">{project.rootPath}</div>

                {gitSummary ? (
                  <div
                    className="project-git-stats"
                    aria-label="Git branch and change summary"
                  >
                    <GitCommitHorizontal size={13} />
                    {gitSummary.currentBranch ? (
                      <span className="project-git-branch">{gitSummary.currentBranch}</span>
                    ) : null}
                    <span className="project-git-plus">
                      +{gitSummary.additions}
                    </span>
                    <span className="project-git-minus">
                      -{gitSummary.deletions}
                    </span>
                    <span>{gitSummary.filesChanged} files</span>
                  </div>
                ) : null}
              </div>

              {isExpanded ? (
                <div
                  className="project-actions"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Keep deploy links in the content area and pin action buttons to a dedicated footer row. */}
                  {deployRoutes.length > 0 ? (
                    <div className="project-deploy-links" aria-label="Deploy links">
                      {deployRoutes.map((route) => (
                        <a
                          key={`${project.id}:${route.id}:${route.previewUrl}`}
                          className="project-deploy-link"
                          href={route.previewUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${formatDeployRouteLabel(route)}`}
                        >
                          <span className="project-deploy-link-label">{formatDeployRouteLabel(route)}</span>
                          <span className="project-deploy-link-url">{formatDeployRouteHost(route.previewUrl)}</span>
                        </a>
                      ))}
                    </div>
                  ) : null}

                  <div className="project-actions-footer">
                    {!isActive ? (
                      <button
                        className="btn outline project-action-button"
                        onClick={() => props.onSelectProject(project.id)}
                      >
                        Select
                      </button>
                    ) : (
                      <button
                        className="btn outline project-action-button"
                        disabled
                        title="Already selected"
                      >
                        Selected
                      </button>
                    )}

                    <button
                      className={isDeployed ? "btn outline project-action-button" : "btn primary project-action-button"}
                      onClick={() => {
                        if (isDeployed) {
                          props.onStopProjectDeploy(project.id);
                          return;
                        }
                        props.onDeployProject(project.id);
                      }}
                      type="button"
                    >
                      {isDeployed ? "Stop deploy" : "Deploy"}
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </>
  );
};
