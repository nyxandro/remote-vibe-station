/**
 * @fileoverview Formatting toolbar for markdown editors.
 *
 * Exports:
 * - MarkdownToolbar - Renders a row of icon buttons for common formatting tasks.
 */

import { Bold, Italic, List, CheckSquare, Code, Link, Heading2 } from "lucide-react";

type Props = {
  onCommand: (command: MarkdownCommand) => void;
  disabled?: boolean;
};

export type MarkdownCommand = "bold" | "italic" | "list" | "checklist" | "code" | "link" | "heading";

export const MarkdownToolbar = (props: Props) => {
  return (
    <div className="markdown-toolbar">
      <button
        className="markdown-toolbar-btn"
        onClick={() => props.onCommand("bold")}
        disabled={props.disabled}
        type="button"
        title="Bold"
        aria-label="Bold"
      >
        <Bold size={16} />
      </button>
      <button
        className="markdown-toolbar-btn"
        onClick={() => props.onCommand("italic")}
        disabled={props.disabled}
        type="button"
        title="Italic"
        aria-label="Italic"
      >
        <Italic size={16} />
      </button>
      <button
        className="markdown-toolbar-btn"
        onClick={() => props.onCommand("heading")}
        disabled={props.disabled}
        type="button"
        title="Heading"
        aria-label="Heading"
      >
        <Heading2 size={16} />
      </button>
      <div className="markdown-toolbar-divider" />
      <button
        className="markdown-toolbar-btn"
        onClick={() => props.onCommand("list")}
        disabled={props.disabled}
        type="button"
        title="Bullet list"
        aria-label="Bullet list"
      >
        <List size={16} />
      </button>
      <button
        className="markdown-toolbar-btn"
        onClick={() => props.onCommand("checklist")}
        disabled={props.disabled}
        type="button"
        title="Checklist"
        aria-label="Checklist"
      >
        <CheckSquare size={16} />
      </button>
      <div className="markdown-toolbar-divider" />
      <button
        className="markdown-toolbar-btn"
        onClick={() => props.onCommand("code")}
        disabled={props.disabled}
        type="button"
        title="Code"
        aria-label="Code"
      >
        <Code size={16} />
      </button>
      <button
        className="markdown-toolbar-btn"
        onClick={() => props.onCommand("link")}
        disabled={props.disabled}
        type="button"
        title="Link"
        aria-label="Link"
      >
        <Link size={16} />
      </button>
    </div>
  );
};
