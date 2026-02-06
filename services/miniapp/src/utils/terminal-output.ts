/**
 * @fileoverview Terminal output sanitization helpers for Mini App plain-text rendering.
 *
 * Exports:
 * - sanitizeTerminalChunk (L28) - Strips ANSI/control sequences from PTY chunks.
 */

/*
 * ANSI CSI: ESC [ ... command
 * We remove these because the Mini App renders plain <pre>, not a true terminal emulator.
 */
const ANSI_CSI_REGEX = /\u001b\[[0-?]*[ -/]*[@-~]/g;

/*
 * ANSI OSC: ESC ] ... BEL or ESC \ 
 * OSC is also terminal-control metadata (title changes, hyperlinks, etc.).
 */
const ANSI_OSC_REGEX = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/*
 * Remove all remaining C0 control chars except tab/newline/carriage return.
 * Keeping \n preserves multiline logs; keeping \t preserves alignment.
 */
const NON_PRINTABLE_CONTROL_REGEX = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export const sanitizeTerminalChunk = (chunk: string): string => {
  /* Keep function strict: required payload must be string. */
  if (typeof chunk !== "string") {
    return "";
  }

  /*
   * Strip ANSI controls first, then remove leftover control bytes.
   * This fixes artifacts like `?[2004h` from bracketed-paste mode toggles.
   */
  const withoutAnsi = chunk.replace(ANSI_OSC_REGEX, "").replace(ANSI_CSI_REGEX, "");
  return withoutAnsi.replace(NON_PRINTABLE_CONTROL_REGEX, "");
};
