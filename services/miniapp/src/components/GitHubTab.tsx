/**
 * @fileoverview GitHub/Git operations tab for selected project repository.
 *
 * Exports:
 * - GitOverview (L13) - Git overview payload alias.
 * - GitHubTab (L31) - Mobile-first UI for branch control and core git actions.
 */

import { useMemo, useState } from "react";

import { GitOverview as GitOverviewModel } from "../types";

export type GitOverview = GitOverviewModel;

type Props = {
  activeId: string | null;
  overview: GitOverview | null | undefined;
  onRefresh: () => void;
  onCheckout: (branch: string) => void;
  onCommit: (message: string) => void;
  onFetch: () => void;
  onPull: () => void;
  onPush: () => void;
  onMerge: (sourceBranch: string) => void;
};

export const GitHubTab = (props: Props) => {
  const [targetBranch, setTargetBranch] = useState<string>("");
  const [commitMessage, setCommitMessage] = useState<string>("");
  const [mergeSource, setMergeSource] = useState<string>("");

  const mergeCandidates = useMemo(() => {
    /* Exclude current branch from merge source options. */
    if (!props.overview) {
      return [] as string[];
    }
    return props.overview.branches.filter((branch) => branch !== props.overview?.currentBranch);
  }, [props.overview]);

  return (
    <section className="git-tab-shell">
      <div className="panel-title">GitHub</div>

      {!props.activeId ? (
        <div className="placeholder">Select a project first.</div>
      ) : null}

      {props.activeId && !props.overview ? (
        <div className="placeholder">No git repository detected in this project.</div>
      ) : null}

      {props.activeId && props.overview ? (
        <>
          <div className="git-card">
            <div className="git-branch-line">
              <span className="git-branch-name">{props.overview.currentBranch}</span>
              <span className="git-upstream-stats">
                ↑{props.overview.ahead} ↓{props.overview.behind}
              </span>
            </div>

            <div className="git-actions-row">
              <button className="btn outline" onClick={props.onRefresh} type="button">
                Refresh
              </button>
              <button className="btn outline" onClick={props.onFetch} type="button">
                Fetch
              </button>
              <button className="btn" onClick={props.onPull} type="button">
                Pull
              </button>
              <button className="btn" onClick={props.onPush} type="button">
                Push
              </button>
            </div>
          </div>

          <div className="git-card">
            <div className="git-field-label">Switch branch</div>
            <div className="git-actions-row">
              <select
                className="input git-select"
                value={targetBranch}
                onChange={(event) => setTargetBranch(event.target.value)}
              >
                <option value="">Choose branch</option>
                {props.overview.branches.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
              <button
                className="btn outline"
                disabled={!targetBranch}
                onClick={() => props.onCheckout(targetBranch)}
                type="button"
              >
                Switch
              </button>
            </div>
          </div>

          <div className="git-card">
            <div className="git-field-label">Merge into {props.overview.currentBranch}</div>
            <div className="git-actions-row">
              <select
                className="input git-select"
                value={mergeSource}
                onChange={(event) => setMergeSource(event.target.value)}
              >
                <option value="">Choose source branch</option>
                {mergeCandidates.map((branch) => (
                  <option key={branch} value={branch}>
                    {branch}
                  </option>
                ))}
              </select>
              <button
                className="btn outline"
                disabled={!mergeSource}
                onClick={() => props.onMerge(mergeSource)}
                type="button"
              >
                Merge
              </button>
            </div>
          </div>

          <div className="git-card">
            <div className="git-field-label">Commit all changes</div>
            <div className="git-actions-row">
              <input
                className="input git-select"
                placeholder="Commit message"
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
              />
              <button
                className="btn primary"
                disabled={!commitMessage.trim()}
                onClick={() => {
                  props.onCommit(commitMessage.trim());
                  setCommitMessage("");
                }}
                type="button"
              >
                Commit
              </button>
            </div>
          </div>

          <div className="git-card">
            <div className="git-field-label">Changed files</div>
            <div className="git-file-list">
              {props.overview.files.length === 0 ? (
                <div className="placeholder">Working tree clean.</div>
              ) : (
                props.overview.files.map((file) => (
                  <article key={`${file.status}:${file.path}`} className="git-file-row">
                    <div className="git-file-main">
                      <span className={`git-file-status git-file-status-${file.status}`}>{file.status}</span>
                      <span className="git-file-path">{file.path}</span>
                    </div>
                    <div className="git-file-delta">
                      <span className="project-git-plus">+{file.additions}</span>
                      <span className="project-git-minus">-{file.deletions}</span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
};
