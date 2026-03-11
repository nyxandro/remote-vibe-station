/**
 * @fileoverview Shared JSON file helpers for backend persistence stores.
 *
 * Exports:
 * - JsonReadErrorStrategy - Recovery mode for parse/normalize failures.
 * - readJsonFileSync - Synchronous JSON loader with optional recovery.
 * - readJsonFileAsync - Asynchronous JSON loader with optional recovery.
 * - writeJsonFileSyncAtomic - Crash-safe synchronous JSON writer.
 * - writeJsonFileAsyncAtomic - Crash-safe asynchronous JSON writer.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type JsonReadErrorStrategy = "recover" | "throw";

type ReadJsonFileInput<T> = {
  filePath: string;
  label: string;
  createEmptyValue: () => T;
  normalize: (parsed: unknown) => T;
  parseErrorStrategy: JsonReadErrorStrategy;
  normalizeErrorStrategy: JsonReadErrorStrategy;
};

type WriteJsonFileOptions = {
  mode?: number;
};

const buildCorruptionBackupPath = (filePath: string): string => `${filePath}.corrupt-${Date.now()}`;

const buildFailureMessage = (input: {
  phase: "parse" | "normalize";
  label: string;
  filePath: string;
  error: unknown;
}): string => {
  /* Keep thrown errors explicit so operators know which store/file needs manual attention. */
  const details = input.error instanceof Error ? input.error.message : String(input.error);
  return `Failed to ${input.phase} ${input.label} JSON at '${input.filePath}': ${details}`;
};

const logRecovery = (input: { label: string; message: string; extra: Record<string, unknown> }): void => {
  /* Structured console logs are enough here because stores run inside trusted backend process. */
  // eslint-disable-next-line no-console
  console.error(`[${input.label}] ${input.message}`, input.extra);
};

const ensureParentDirSync = (filePath: string): void => {
  /* All JSON stores live under backend data directories that may not exist on first boot. */
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
};

const ensureParentDirAsync = async (filePath: string): Promise<void> => {
  /* Async stores share the same lazy directory bootstrap behaviour. */
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
};

const recoverParseErrorSync = <T>(input: ReadJsonFileInput<T>, error: unknown): T => {
  /* Recoverable stores keep malformed files for inspection, then continue from a clean fallback. */
  if (input.parseErrorStrategy === "throw") {
    throw new Error(buildFailureMessage({ phase: "parse", label: input.label, filePath: input.filePath, error }));
  }

  const backupPath = buildCorruptionBackupPath(input.filePath);
  try {
    fs.renameSync(input.filePath, backupPath);
    logRecovery({
      label: input.label,
      message: "corrupted JSON store moved aside",
      extra: {
        filePath: input.filePath,
        backupPath,
        error: error instanceof Error ? error.message : String(error)
      }
    });
  } catch (backupError) {
    logRecovery({
      label: input.label,
      message: "failed to back up corrupted JSON store",
      extra: {
        filePath: input.filePath,
        backupPath,
        error: backupError instanceof Error ? backupError.message : String(backupError)
      }
    });
    fs.rmSync(input.filePath, { force: true });
  }

  return input.createEmptyValue();
};

const recoverParseErrorAsync = async <T>(input: ReadJsonFileInput<T>, error: unknown): Promise<T> => {
  /* Async stores follow the same backup-and-reset strategy as sync stores. */
  if (input.parseErrorStrategy === "throw") {
    throw new Error(buildFailureMessage({ phase: "parse", label: input.label, filePath: input.filePath, error }));
  }

  const backupPath = buildCorruptionBackupPath(input.filePath);
  try {
    await fs.promises.rename(input.filePath, backupPath);
    logRecovery({
      label: input.label,
      message: "corrupted JSON store moved aside",
      extra: {
        filePath: input.filePath,
        backupPath,
        error: error instanceof Error ? error.message : String(error)
      }
    });
  } catch (backupError) {
    logRecovery({
      label: input.label,
      message: "failed to back up corrupted JSON store",
      extra: {
        filePath: input.filePath,
        backupPath,
        error: backupError instanceof Error ? backupError.message : String(backupError)
      }
    });
    await fs.promises.rm(input.filePath, { force: true });
  }

  return input.createEmptyValue();
};

const recoverNormalizeError = <T>(input: ReadJsonFileInput<T>, error: unknown): T => {
  /* Normalization failures are schema issues, not raw disk corruption. */
  if (input.normalizeErrorStrategy === "throw") {
    throw new Error(buildFailureMessage({ phase: "normalize", label: input.label, filePath: input.filePath, error }));
  }

  logRecovery({
    label: input.label,
    message: "failed to normalize JSON store",
    extra: {
      filePath: input.filePath,
      error: error instanceof Error ? error.message : String(error)
    }
  });
  return input.createEmptyValue();
};

export const readJsonFileSync = <T>(input: ReadJsonFileInput<T>): T => {
  /* Sync stores use small JSON files, so direct read/parse keeps the implementation simple. */
  ensureParentDirSync(input.filePath);
  if (!fs.existsSync(input.filePath)) {
    return input.createEmptyValue();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(input.filePath, "utf-8")) as unknown;
  } catch (error) {
    return recoverParseErrorSync(input, error);
  }

  try {
    return input.normalize(parsed);
  } catch (error) {
    return recoverNormalizeError(input, error);
  }
};

export const readJsonFileAsync = async <T>(input: ReadJsonFileInput<T>): Promise<T> => {
  /* Async stores reuse the same semantics while avoiding blocking filesystem calls in hot paths. */
  await ensureParentDirAsync(input.filePath);

  let raw: string;
  try {
    raw = await fs.promises.readFile(input.filePath, "utf-8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return input.createEmptyValue();
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return recoverParseErrorAsync(input, error);
  }

  try {
    return input.normalize(parsed);
  } catch (error) {
    return recoverNormalizeError(input, error);
  }
};

export const writeJsonFileSyncAtomic = (filePath: string, value: unknown, options?: WriteJsonFileOptions): void => {
  /* Temp-file rename avoids partially written JSON during crashes or interrupted writes. */
  ensureParentDirSync(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), {
      encoding: "utf-8",
      ...(typeof options?.mode === "number" ? { mode: options.mode } : {})
    });
    fs.renameSync(tempPath, filePath);
    if (typeof options?.mode === "number") {
      fs.chmodSync(filePath, options.mode);
    }
  } finally {
    if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { force: true });
    }
  }
};

export const writeJsonFileAsyncAtomic = async (
  filePath: string,
  value: unknown,
  options?: WriteJsonFileOptions
): Promise<void> => {
  /* Async stores keep the same atomic write semantics and optional file mode support. */
  await ensureParentDirAsync(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await fs.promises.writeFile(tempPath, JSON.stringify(value, null, 2), {
      encoding: "utf-8",
      ...(typeof options?.mode === "number" ? { mode: options.mode } : {})
    });
    await fs.promises.rename(tempPath, filePath);
    if (typeof options?.mode === "number") {
      await fs.promises.chmod(filePath, options.mode);
    }
  } finally {
    await fs.promises.rm(tempPath, { force: true });
  }
};
