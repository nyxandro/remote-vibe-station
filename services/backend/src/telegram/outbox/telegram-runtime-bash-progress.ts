/**
 * @fileoverview Stable bash progress-key resolution for Telegram runtime updates.
 *
 * Exports:
 * - resolveTelegramBashProgressKey - Reuses one replace key across noisy OpenCode bash part-id churn.
 */

const BASH_PROGRESS_MAP_PREFIX = "bash-part:";
const BASH_PROGRESS_KEY_PREFIX = "bash:";

export const resolveTelegramBashProgressKey = (input: {
  adminId: number;
  sessionID: string;
  part: any;
  command: string;
  status: string;
  bashProgressKeyByPart: Map<string, string>;
}): string => {
  /* Runtime can rotate both callID and part.id between updates, so session+command stays the stable anchor. */
  const callId = String(input.part.callID ?? "").trim();
  const partId = String(input.part.id ?? "").trim();
  const stablePartToken = `cmd:${input.command}`;
  const mapKey = `${BASH_PROGRESS_MAP_PREFIX}${input.adminId}:${input.sessionID}:${stablePartToken}`;
  const existing = input.bashProgressKeyByPart.get(mapKey);
  if (existing) {
    if (input.status === "completed" || input.status === "error") {
      input.bashProgressKeyByPart.delete(mapKey);
    }
    return existing;
  }

  const progressIdentity = partId || callId || input.command;
  const progressKey = `${BASH_PROGRESS_KEY_PREFIX}${input.adminId}:${input.sessionID}:${progressIdentity}`;
  if (input.status !== "completed" && input.status !== "error") {
    input.bashProgressKeyByPart.set(mapKey, progressKey);
  }
  return progressKey;
};
