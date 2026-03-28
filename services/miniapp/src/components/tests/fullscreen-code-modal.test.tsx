/**
 * @fileoverview Focus regression tests for the shared fullscreen code modal.
 */

/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEffect, useRef } from "react";

vi.mock("../CodeEditor", () => ({
  /* Replace CodeMirror with a plain textarea so focus assertions stay deterministic in jsdom. */
  CodeEditor: (props: { autoFocus?: boolean; value: string; onChange: (value: string) => void }) => {
    const editorRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
      if (props.autoFocus) {
        editorRef.current?.focus();
      }
    }, [props.autoFocus]);

    return (
      <textarea
        aria-label="Mock code editor"
        onChange={(event) => props.onChange(event.target.value)}
        ref={editorRef}
        value={props.value}
      />
    );
  }
}));

import { FullscreenCodeModal } from "../FullscreenCodeModal";

describe("FullscreenCodeModal", () => {
  afterEach(() => {
    /* Keep modal focus and DOM state isolated between regression tests. */
    cleanup();
  });

  it("keeps editor focus while typing rerenders the parent modal", () => {
    /* Editor typing updates parent state on every keystroke, so modal effects must not steal focus back. */
    const onChange = vi.fn();
    const { rerender } = render(
      <FullscreenCodeModal
        autoFocus={true}
        filePath="src/demo.txt"
        isOpen={true}
        language="text"
        onChange={onChange}
        onClose={vi.fn()}
        themeMode="dark"
        value="a"
      />
    );

    const editor = screen.getByRole("textbox", { name: "Mock code editor" });
    editor.focus();
    expect(document.activeElement).toBe(editor);

    rerender(
      <FullscreenCodeModal
        autoFocus={true}
        filePath="src/demo.txt"
        isOpen={true}
        language="text"
        onChange={onChange}
        onClose={vi.fn()}
        themeMode="dark"
        value="ab"
      />
    );

    expect(document.activeElement).toBe(editor);
  });
});
