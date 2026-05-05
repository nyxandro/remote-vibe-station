/**
 * @fileoverview Terminal tab UI.
 *
 * Exports:
 * - TerminalTab (L15) - Renders terminal output and input.
 */

import { FolderGit2, SendHorizontal, TerminalSquare } from "lucide-react";

type Props = {
  activeId: string | null;
  buffer: string;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
};

export const TerminalTab = (props: Props) => {
  /* Render terminal output and input row. */
  return (
    <div className="terminal-shell">
      {/* Hero — keeps the section identity visible and shows the active project context. */}
      <header className="terminal-hero">
        <div className="terminal-hero-title">
          <TerminalSquare size={18} aria-hidden />
          <span>Терминал</span>
        </div>
        <div className="terminal-hero-meta">
          <span className="terminal-hero-counter">
            <FolderGit2 size={14} aria-hidden />
            {props.activeId ? props.activeId : "проект не выбран"}
          </span>
        </div>
      </header>

      <pre className="log-box terminal-output">{props.buffer || "(no output yet)"}</pre>

      {/* Keep the command field flexible so the send button stays on the same row on narrow screens. */}
      <div className="terminal-input-row">
        <input
          className="input terminal-input-field"
          placeholder="Type a command (e.g. ls)"
          value={props.input}
          onChange={(e) => props.onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && props.activeId) {
              props.onSend();
            }
          }}
        />
        <button
          className="terminal-send-btn"
          disabled={!props.activeId}
          onClick={props.onSend}
          type="button"
          title="Send command"
          aria-label="Send command"
        >
          <SendHorizontal size={16} className="btn-icon" />
        </button>
      </div>
    </div>
  );
};
