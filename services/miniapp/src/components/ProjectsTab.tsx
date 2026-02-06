/**
 * @fileoverview Projects tab UI.
 *
 * Exports:
 * - ProjectsTab (L22) - Renders project search, actions, and stream indicator.
 */

import { ChangeEvent, useState } from "react";
import { Container, GitCommitHorizontal, Plus } from "lucide-react";

import { ProjectGitSummary, ProjectRecord, ProjectStatus } from "../types";
import { deriveProjectContainerHealth } from "../utils/project-container-health";

type Props = {
  visibleProjects: ProjectRecord[];
  activeId: string | null;
  query: string;
  telegramStreamEnabled: boolean;
  statusMap: Record<string, ProjectStatus[] | undefined>;
  gitSummaryMap: Record<string, ProjectGitSummary | null | undefined>;
  onQueryChange: (value: string) => void;
  onSelectProject: (projectId: string) => void;
  onCreateProjectFolder: (name: string) => void;
  onCloneRepository: (repositoryUrl: string, folderName?: string) => void;
};

export const ProjectsTab = (props: Props) => {
  /* Projects listing + creation actions. */
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [cloneOpen, setCloneOpen] = useState<boolean>(false);
  const [folderName, setFolderName] = useState<string>("");
  const [repoUrl, setRepoUrl] = useState<string>("");
  const [cloneFolderName, setCloneFolderName] = useState<string>("");

  return (
    <>
      <div className="panel-toolbar">
        <input
          className="input project-search-input"
          placeholder="Search projects…"
          value={props.query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => props.onQueryChange(e.target.value)}
        />

        <div className="project-create-menu-shell">
          <button
            className="btn outline project-create-btn"
            onClick={() => setMenuOpen((prev) => !prev)}
            type="button"
            aria-label="Create project"
          >
            <Plus size={16} />
          </button>

          {menuOpen ? (
            <div className="project-create-menu">
              <button
                className="btn outline"
                onClick={() => {
                  setCreateOpen(true);
                  setCloneOpen(false);
                  setMenuOpen(false);
                }}
                type="button"
              >
                Создать папку проекта
              </button>
              <button
                className="btn outline"
                onClick={() => {
                  setCloneOpen(true);
                  setCreateOpen(false);
                  setMenuOpen(false);
                }}
                type="button"
              >
                Клонировать git репозиторий
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {createOpen ? (
        <div className="project-create-panel">
          <div className="project-create-title">Создать папку проекта</div>
          <input
            className="input"
            placeholder="project-name"
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
          />
          <div className="project-create-actions">
            <button
              className="btn"
              disabled={!folderName.trim()}
              onClick={() => {
                props.onCreateProjectFolder(folderName.trim());
                setFolderName("");
                setCreateOpen(false);
              }}
              type="button"
            >
              Create
            </button>
            <button className="btn ghost" onClick={() => setCreateOpen(false)} type="button">
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {cloneOpen ? (
        <div className="project-create-panel">
          <div className="project-create-title">Клонировать git репозиторий</div>
          <input
            className="input"
            placeholder="https://github.com/org/repo.git"
            value={repoUrl}
            onChange={(event) => setRepoUrl(event.target.value)}
          />
          <input
            className="input"
            placeholder="folder name (optional)"
            value={cloneFolderName}
            onChange={(event) => setCloneFolderName(event.target.value)}
          />
          <div className="project-create-note">
            Используются git credentials, настроенные в backend runtime/container.
          </div>
          <div className="project-create-actions">
            <button
              className="btn"
              disabled={!repoUrl.trim()}
              onClick={() => {
                props.onCloneRepository(repoUrl.trim(), cloneFolderName.trim() || undefined);
                setRepoUrl("");
                setCloneFolderName("");
                setCloneOpen(false);
              }}
              type="button"
            >
              Clone
            </button>
            <button className="btn ghost" onClick={() => setCloneOpen(false)} type="button">
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="project-grid">
        {props.visibleProjects.map((project) => {
          const isActive = project.id === props.activeId;
          const showStream = isActive && props.telegramStreamEnabled;
          const health = deriveProjectContainerHealth(props.statusMap[project.id]);
          const healthClass = health ? `project-health project-health-${health.level}` : null;
          const gitSummary = props.gitSummaryMap[project.id] ?? null;

          return (
            <article key={project.id} className={isActive ? "project-card active" : "project-card"}>
              <div className="project-meta">
                <div className="project-top">
                  <div className="project-name-row">
                    <div className="project-name">{project.name}</div>
                    {showStream ? (
                      <span className="stream-pill" title="Streaming to Telegram">
                        <span className="stream-dot" />
                        STREAM
                      </span>
                    ) : null}
                  </div>

                  {health ? (
                    <span className={healthClass} aria-label={`Containers ${health.countLabel}`}>
                      <Container size={13} />
                      {health.countLabel}
                    </span>
                  ) : null}
                </div>
                <div className="project-path">{project.rootPath}</div>

                {gitSummary ? (
                  <div className="project-git-stats" aria-label="Uncommitted git changes">
                    <GitCommitHorizontal size={13} />
                    <span className="project-git-plus">+{gitSummary.additions}</span>
                    <span className="project-git-minus">-{gitSummary.deletions}</span>
                    <span>{gitSummary.filesChanged} files</span>
                  </div>
                ) : null}
              </div>

              <div className="project-actions">
                {!isActive ? (
                  <button className="btn outline" onClick={() => props.onSelectProject(project.id)}>
                    Select
                  </button>
                ) : (
                  <button className="btn outline" disabled title="Already selected">
                    Selected
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
};
