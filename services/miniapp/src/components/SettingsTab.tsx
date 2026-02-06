/**
 * @fileoverview Settings accordion with OpenCode rules/config editors.
 *
 * Exports:
 * - SettingsTab (L41) - Renders sectioned settings UI and embedded file editor.
 */

import { useEffect, useMemo, useState } from "react";
import { MoonStar, Sun } from "lucide-react";

import { OpenCodeSettingsKind, OpenCodeSettingsOverview, SettingsFileSummary } from "../types";
import { ThemeMode } from "../utils/theme";
import { CodeEditor } from "./CodeEditor";

type ActiveFile = {
  kind: OpenCodeSettingsKind;
  relativePath?: string;
  absolutePath: string;
  content: string;
  exists: boolean;
} | null;

type Props = {
  activeId: string | null;
  themeMode: ThemeMode;
  overview: OpenCodeSettingsOverview | null;
  activeFile: ActiveFile;
  onChangeTheme: (mode: ThemeMode) => void;
  onRefreshProjects: () => void;
  onSyncProjects: () => void;
  onRestartOpenCode: () => void;
  onLoadOverview: () => void;
  onOpenFile: (kind: OpenCodeSettingsKind, relativePath?: string) => void;
  onCreateFile: (kind: OpenCodeSettingsKind, name?: string) => void;
  onSaveActiveFile: (content: string) => void;
  onDeleteActiveProject: () => void;
  restartOpenCodeState: {
    isRestarting: boolean;
    lastResult: "idle" | "success" | "error";
  };
};

export const SettingsTab = (props: Props) => {
  const [draft, setDraft] = useState<string>("");
  const [createNameByKind, setCreateNameByKind] = useState<Record<string, string>>({});

  const language = useMemo(() => {
    /* Infer editor language from file extension for better editing UX. */
    const name = props.activeFile?.relativePath ?? props.activeFile?.absolutePath ?? "";
    if (name.toLowerCase().endsWith(".json")) {
      return "json" as const;
    }
    if (name.toLowerCase().endsWith(".md")) {
      return "markdown" as const;
    }
    return "text" as const;
  }, [props.activeFile]);

  useEffect(() => {
    /* Reset editor draft when another file is opened. */
    setDraft(props.activeFile?.content ?? "");
  }, [props.activeFile?.absolutePath, props.activeFile?.content]);

  const renderListSection = (input: {
    title: string;
    kind: OpenCodeSettingsKind;
    items: SettingsFileSummary[];
    emptyText: string;
  }) => {
    /* Reusable block for agents/commands/skills/plugins. */
    const createName = createNameByKind[input.kind] ?? "";
    return (
      <details className="settings-accordion-item">
        <summary>{input.title}</summary>
        <div className="settings-accordion-body">
          {input.items.length === 0 ? <div className="placeholder">{input.emptyText}</div> : null}

          {input.items.map((item) => (
            <button
              key={`${input.kind}:${item.relativePath}`}
              className="btn outline"
              onClick={() => {
                props.onOpenFile(input.kind, item.relativePath);
              }}
              type="button"
            >
              {item.relativePath}
            </button>
          ))}

          <div className="settings-create-row">
            <input
              className="input"
              placeholder="filename.ext"
              value={createName}
              onChange={(event) =>
                setCreateNameByKind((prev) => ({ ...prev, [input.kind]: event.target.value }))
              }
            />
            <button className="btn" onClick={() => props.onCreateFile(input.kind, createName)} type="button">
              Create
            </button>
          </div>
        </div>
      </details>
    );
  };

  return (
    <section className="settings-shell">
      <div className="settings-header-row">
        <h3 className="panel-title">Settings</h3>
        <button className="btn outline" onClick={props.onLoadOverview} type="button">
          Reload
        </button>
      </div>

      <details className="settings-accordion-item" open>
        <summary>1. Правила агента</summary>
        <div className="settings-accordion-body">
          <button className="btn outline" onClick={() => props.onOpenFile("globalRule")} type="button">
            Global AGENTS.md
          </button>
          {!props.overview?.globalRule.exists ? (
            <button className="btn" onClick={() => props.onCreateFile("globalRule")} type="button">
              Создать Global AGENTS.md
            </button>
          ) : null}

          {props.activeId ? (
            <>
              <button className="btn outline" onClick={() => props.onOpenFile("projectRule")} type="button">
                Project AGENTS.md
              </button>
              {!props.overview?.projectRule?.exists ? (
                <button className="btn" onClick={() => props.onCreateFile("projectRule")} type="button">
                  Создать Project AGENTS.md
                </button>
              ) : null}
            </>
          ) : (
            <div className="placeholder">Select project for local AGENTS.md.</div>
          )}
        </div>
      </details>

      {renderListSection({
        title: "2. Агенты",
        kind: "agent",
        items: props.overview?.agents ?? [],
        emptyText: "Папка agents пустая. Создай новый md файл."
      })}

      <details className="settings-accordion-item">
        <summary>3. Конфиг OpenCode</summary>
        <div className="settings-accordion-body">
          <button className="btn outline" onClick={() => props.onOpenFile("config")} type="button">
            OpenCode config
          </button>
          {!props.overview?.config.exists ? (
            <button className="btn" onClick={() => props.onCreateFile("config")} type="button">
              Создать opencode.json
            </button>
          ) : null}
        </div>
      </details>

      {renderListSection({
        title: "4. Commands",
        kind: "command",
        items: props.overview?.commands ?? [],
        emptyText: "Commands пусто. Можно создать новый файл для проекта."
      })}

      {renderListSection({
        title: "5. Skills",
        kind: "skill",
        items: props.overview?.skills ?? [],
        emptyText: "Skills не найдены."
      })}

      {renderListSection({
        title: "6. Plugins",
        kind: "plugin",
        items: props.overview?.plugins ?? [],
        emptyText: "Plugins не найдены."
      })}

      <details className="settings-accordion-item">
        <summary>7. Настройки проекта</summary>
        <div className="settings-accordion-body">
          {props.activeId ? (
            <button className="btn ghost" onClick={props.onDeleteActiveProject} type="button">
              Удалить выбранный проект локально
            </button>
          ) : (
            <div className="placeholder">Выбери проект, чтобы управлять удалением.</div>
          )}
          <div className="project-create-note">
            Если проект — git репозиторий с незакоммиченными изменениями, удаление блокируется.
          </div>
        </div>
      </details>

      <details className="settings-accordion-item">
        <summary>8. Общие настройки</summary>
        <div className="settings-accordion-body">
          <div className="settings-theme-toggle" role="group" aria-label="Theme mode">
            <button
              className={props.themeMode === "light" ? "btn outline active" : "btn outline"}
              onClick={() => props.onChangeTheme("light")}
              type="button"
            >
              <Sun size={16} className="btn-icon" /> Day
            </button>
            <button
              className={props.themeMode === "dark" ? "btn outline active" : "btn outline"}
              onClick={() => props.onChangeTheme("dark")}
              type="button"
            >
              <MoonStar size={16} className="btn-icon" /> Night
            </button>
          </div>

          <div className="settings-actions-grid">
            <button className="btn outline" onClick={props.onRefreshProjects} type="button">
              Обновить список проектов
            </button>
            <button className="btn outline" onClick={props.onSyncProjects} type="button">
              Синхронизировать OpenCode
            </button>
            <button
              className="btn outline"
              onClick={props.onRestartOpenCode}
              disabled={props.restartOpenCodeState.isRestarting}
              type="button"
            >
              {props.restartOpenCodeState.isRestarting ? "Перезапуск..." : "Перезагрузить OpenCode"}
            </button>
            {props.restartOpenCodeState.lastResult === "success" ? (
              <div className="project-create-note">OpenCode успешно перезагружен.</div>
            ) : null}
            {props.restartOpenCodeState.lastResult === "error" ? (
              <div className="project-create-note">Ошибка перезапуска OpenCode. Проверь логи backend.</div>
            ) : null}
          </div>
        </div>
      </details>

      {props.activeFile ? (
        <div className="settings-editor-card">
          <div className="settings-editor-meta">{props.activeFile.absolutePath}</div>
          <CodeEditor
            value={draft}
            language={language}
            onChange={(value) => setDraft(value)}
          />
          <button
            className="btn primary"
            onClick={() => {
              props.onSaveActiveFile(draft);
            }}
            type="button"
          >
            Save
          </button>
        </div>
      ) : null}
    </section>
  );
};
