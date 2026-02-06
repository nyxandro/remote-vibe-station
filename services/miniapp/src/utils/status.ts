/**
 * @fileoverview Status formatting utilities.
 *
 * Exports:
 * - formatProjectStatus (L8) - Human readable status label.
 */

export const formatProjectStatus = (status: string): string => {
  /* Normalize status values for display. */
  if (status === "running") {
    return "Active";
  }
  if (status === "stopped") {
    return "Stopped";
  }
  return "Unknown";
};
