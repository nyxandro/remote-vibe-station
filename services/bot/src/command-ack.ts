/**
 * @fileoverview User-facing acknowledgements for dispatched OpenCode slash commands.
 *
 * Exports:
 * - buildCommandQueuedMessage - Formats the immediate Telegram confirmation after backend accepts a custom command.
 */

export const buildCommandQueuedMessage = (commandName: string): string => {
  /* Keep the acknowledgement explicit so users know the workflow is queued even before the agent replies. */
  const normalized = commandName.trim();
  return `Workflow команда '/${normalized}' отправлена в чат агента.`;
};
