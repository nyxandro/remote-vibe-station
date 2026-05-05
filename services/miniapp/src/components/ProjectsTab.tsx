/**
 * @fileoverview Projects tab UI.
 *
 * Exports:
 * - ProjectsTab - Renders project search, selection, creation, and compact project indicators.
 */

import { ChangeEvent, useState } from "react";
import { Container, FolderKanban, GitCommitHorizontal, Plus } from "lucide-react";

import { ProjectAddModal } from "./ProjectAddModal";
import { ProjectGitSummary, ProjectRecord, ProjectStatus } from "../types";
import { deriveProjectContainerHealth } from "../utils/project-container-health";

type Props = {
  visibleProjects: ProjectRecord[];
  activeId: string | null;
  query: string;
  statusMap: Record<string, ProjectStatus[] | undefined>;
  gitSummaryMap: Record<string, ProjectGitSummary | null | undefined>;
  onQueryChange: (value: string) => void;
  onSelectProject: (projectId: string) => void;
  onCreateProjectFolder: (name: string) => Promise<void> | void;
  onCloneRepository: (repositoryUrl: string, folderName?: string) => Promise<void> | void;
};

const pluralizeProjects = (count: number): string => {
  /* Russian project counters use one/few/many forms, including 21/22/25 edge cases. */
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return "проект";
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "проекта";
  }

  return "проектов";
};

export const ProjectsTab = (props: Props) => {
  /* Projects list keeps only local view state; add-project inputs now live in a dedicated modal component. */
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

  const toggleCardExpansion = (id: string) => {
    setExpandedCardId((prev) => (prev === id ? null : id));
  };

  return (
    <section className="projects-shell">
      <header className="tab-hero">
        <div className="tab-hero-title">
          <FolderKanban size={18} aria-hidden />
          <span>Проекты</span>
        </div>
        <div className="tab-hero-meta">
          <span className="tab-hero-counter">
            {props.visibleProjects.length} {pluralizeProjects(props.visibleProjects.length)}
          </span>
        </div>
      </header>

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
          const health = deriveProjectContainerHealth(
            props.statusMap[project.id],
          );
          const healthClass = health
            ? `project-health project-health-${health.level}`
            : undefined;
          const gitSummary = props.gitSummaryMap[project.id] ?? null;
          const isExpanded = expandedCardId === project.id;

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

                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
};
