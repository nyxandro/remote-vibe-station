/**
 * @fileoverview Terminal tab UI.
 *
 * Exports:
 * - TerminalTab (L15) - Renders terminal output and input.
 */

import { SendHorizontal } from "lucide-react";

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
      <pre className="log-box terminal-output">{props.buffer || "(no output yet)"}</pre>

      <div className="terminal-input-row">
        <input
          className="input"
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
