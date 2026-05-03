/**
 * @fileoverview Settings accordion for global and project AGENTS.md rule files.
 *
 * Exports:
 * - AgentRulesSettingsAccordion - Renders AGENTS.md open/create actions for Settings.
 */

import { OpenCodeSettingsKind, OpenCodeSettingsOverview } from "../types";

type Props = {
  activeId: string | null;
  overview: OpenCodeSettingsOverview | null;
  onOpenFile: (kind: OpenCodeSettingsKind, relativePath?: string) => void;
  onCreateFile: (kind: OpenCodeSettingsKind, name?: string) => void;
};

export const AgentRulesSettingsAccordion = (props: Props) => {
  return (
    <details className="settings-accordion-item">
      <summary>2. Agent rules</summary>
      <div className="settings-accordion-body">
        {/* Show file entry only when AGENTS.md exists to avoid confusing empty placeholders. */}
        {props.overview?.globalRule.exists ? (
          <button className="btn outline" onClick={() => props.onOpenFile("globalRule")} type="button">
            Global AGENTS.md
          </button>
        ) : null}
        {!props.overview?.globalRule.exists ? (
          <button className="btn" onClick={() => props.onCreateFile("globalRule")} type="button">
            Create Global AGENTS.md
          </button>
        ) : null}

        {props.activeId ? (
          <>
            {/* Keep project rule entry hidden until file is created in selected project. */}
            {props.overview?.projectRule?.exists ? (
              <button className="btn outline" onClick={() => props.onOpenFile("projectRule")} type="button">
                Project AGENTS.md
              </button>
            ) : null}
            {!props.overview?.projectRule?.exists ? (
              <button className="btn" onClick={() => props.onCreateFile("projectRule")} type="button">
                Create Project AGENTS.md
              </button>
            ) : null}
          </>
        ) : (
          <div className="placeholder">Select project for local AGENTS.md.</div>
        )}
      </div>
    </details>
  );
};
