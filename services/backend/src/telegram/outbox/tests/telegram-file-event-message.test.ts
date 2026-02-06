/**
 * @fileoverview Tests for Telegram file operation HTML formatter.
 *
 * Exports:
 * - (none)
 */

import { formatFileOperationMessageHtml } from "../telegram-file-event-message";

describe("formatFileOperationMessageHtml", () => {
  it("renders italic operation with bold diff counters and linked path", () => {
    const html = formatFileOperationMessageHtml({
      kind: "edit",
      absolutePath: "/home/nyx/projects/bazarvokzal/count_to_15.sh",
      additions: 8,
      deletions: 15,
      deepLink: "https://t.me/mybot?startapp=diff_token"
    });

    expect(html).toContain("<i>Редактирование файла <b>+8</b> <b>-15</b></i>");
    expect(html).toContain(
      '<i><a href="https://t.me/mybot?startapp=diff_token"><u><b>/home/nyx/projects/bazarvokzal/count_to_15.sh</b></u></a></i>'
    );
  });
});
