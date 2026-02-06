/**
 * @fileoverview HTML formatter for Telegram file operation runtime events.
 *
 * Exports:
 * - FileOperationKind (L10) - Supported file operation kinds.
 * - formatFileOperationMessageHtml (L23) - Builds italic HTML message with deep link.
 */

export type FileOperationKind = "create" | "edit" | "delete";

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const operationLabel = (kind: FileOperationKind): string => {
  /* Keep labels short and consistent in Telegram runtime feed. */
  if (kind === "create") {
    return "Создание файла";
  }
  if (kind === "delete") {
    return "Удаление файла";
  }
  return "Редактирование файла";
};

export const formatFileOperationMessageHtml = (input: {
  kind: FileOperationKind;
  absolutePath: string;
  additions: number;
  deletions: number;
  deepLink: string;
}): string => {
  /*
   * Required visual format:
   * - Full message in italic.
   * - Diff numbers in bold+italic.
   * - File path is bold+underlined clickable link.
   */
  const label = escapeHtml(operationLabel(input.kind));
  const plus = `+${Math.max(0, Math.trunc(input.additions))}`;
  const minus = `-${Math.max(0, Math.trunc(input.deletions))}`;
  const safePath = escapeHtml(input.absolutePath);
  const safeLink = escapeHtml(input.deepLink);

  const line1 = `<i>${label} <b>${escapeHtml(plus)}</b> <b>${escapeHtml(minus)}</b></i>`;
  const line2 = `<i><a href="${safeLink}"><u><b>${safePath}</b></u></a></i>`;
  return `${line1}\n${line2}`;
};
