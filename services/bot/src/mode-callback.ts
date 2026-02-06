/**
 * @fileoverview Callback data codec for Telegram mode picker menus.
 *
 * Exports:
 * - MODE_CALLBACK_PREFIX (L10) - Prefix that namespaces mode callbacks.
 * - encodeModeCallback (L12) - Build callback data string.
 * - parseModeCallback (L16) - Parse callback data string.
 */

export const MODE_CALLBACK_PREFIX = "mode";

export const encodeModeCallback = (action: string, parts: string[] = []): string =>
  [MODE_CALLBACK_PREFIX, action, ...parts].join("|");

export const parseModeCallback = (value: string): { action: string; parts: string[] } | null => {
  /* Ignore unrelated callback payloads from other bot features. */
  const chunks = value.split("|");
  if (chunks[0] !== MODE_CALLBACK_PREFIX || chunks.length < 2) {
    return null;
  }

  return {
    action: chunks[1],
    parts: chunks.slice(2)
  };
};
