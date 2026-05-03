/**
 * @fileoverview Settings accordion for global GitHub PAT onboarding.
 *
 * Exports:
 * - GitHubAuthSettingsSection - Renders GitHub PAT save/disconnect controls for agent git auth.
 */

import { GithubAuthStatus } from "../types";

type Props = {
  status: GithubAuthStatus | null;
  tokenDraft: string;
  isLoading: boolean;
  isSaving: boolean;
  isDisconnecting: boolean;
  onReload: () => void;
  onTokenDraftChange: (value: string) => void;
  onSaveToken: () => void;
  onDisconnect: () => void;
};

export const GitHubAuthSettingsSection = (props: Props) => {
  return (
    <details className="settings-accordion-item">
      <summary>8. GitHub для git</summary>
      <div className="settings-accordion-body">
        <div className="project-create-note">
          Этот блок хранит один глобальный GitHub token для `git` в backend и OpenCode.
        </div>

        {!props.status ? <div className="placeholder">GitHub status is not loaded yet.</div> : null}

        {props.status ? (
          <>
            <div className="project-create-note">Режим: GitHub Personal Access Token (PAT)</div>
            <div className="project-create-note">Статус: {props.status.connected ? "подключен" : "не подключен"}</div>
            <div className="project-create-note">Сохраненный token: {props.status.tokenPreview ?? "нет"}</div>
            <div className="project-create-note">Обновлен: {props.status.updatedAt ?? "неизвестно"}</div>

            {props.status.gitCredential.connected ? (
              <div className="settings-save-status" aria-live="polite">
                <span className="settings-save-dot" /> Агент и git используют этот GitHub token глобально.
              </div>
            ) : null}

            <label className="project-create-note" htmlFor="github-pat-input">
              Вставь GitHub PAT
            </label>
            <input
              id="github-pat-input"
              aria-label="GitHub personal access token"
              className="input settings-input-compact"
              type="password"
              autoComplete="new-password"
              placeholder="github_pat_..."
              value={props.tokenDraft}
              onChange={(event) => props.onTokenDraftChange(event.target.value)}
            />

            <div className="project-create-note">
              Как получить token: GitHub -&gt; Settings -&gt; Developer settings -&gt; Personal access tokens -&gt; Fine-grained tokens.
            </div>
            <div className="project-create-note">
              Дай доступ к нужным репозиториям и минимум права `Contents: Read and write`, `Metadata: Read`.
            </div>

            <div className="settings-actions-grid">
              <button className="btn outline" onClick={props.onReload} disabled={props.isLoading} type="button">
                {props.isLoading ? "Loading..." : "Reload GitHub status"}
              </button>
              <button
                className="btn outline"
                onClick={props.onSaveToken}
                disabled={props.isSaving || props.tokenDraft.trim().length === 0}
                type="button"
              >
                {props.isSaving ? "Saving..." : "Сохранить token"}
              </button>
              <button
                className="btn ghost"
                onClick={props.onDisconnect}
                disabled={!props.status.connected || props.isDisconnecting}
                type="button"
              >
                {props.isDisconnecting ? "Disconnecting..." : "Отключить GitHub"}
              </button>
            </div>

            <div className="project-create-note">
              После сохранения token будет использоваться для `git clone/pull/push` во всех проектах на этом сервере.
            </div>
          </>
        ) : null}
      </div>
    </details>
  );
};
