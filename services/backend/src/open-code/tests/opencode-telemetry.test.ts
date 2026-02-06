/**
 * @fileoverview Tests for OpenCode telemetry summarization.
 *
 * Exports:
 * - (none)
 */

import { summarizeOpenCodeParts } from "../opencode-telemetry";

describe("summarizeOpenCodeParts", () => {
  it("extracts file changes from write/edit/apply_patch tools", () => {
    const telemetry = summarizeOpenCodeParts([
      {
        type: "tool",
        tool: "write",
        state: {
          status: "completed",
          input: { content: "a\nb\n" },
          metadata: { filepath: "/tmp/new.js", exists: false }
        }
      },
      {
        type: "tool",
        tool: "edit",
        state: {
          status: "completed",
          metadata: { filediff: { file: "/tmp/edit.js", additions: 10, deletions: 3 } }
        }
      },
      {
        type: "tool",
        tool: "apply_patch",
        state: {
          status: "completed",
          metadata: {
            files: [{ filePath: "/tmp/patch.js", type: "update", additions: 7, deletions: 1 }]
          }
        }
      }
    ] as any);

    expect(telemetry.fileChanges).toEqual(
      expect.arrayContaining([
        { kind: "create", path: "/tmp/new.js", additions: 3, deletions: 0 },
        { kind: "edit", path: "/tmp/edit.js", additions: 10, deletions: 3 },
        { kind: "edit", path: "/tmp/patch.js", additions: 7, deletions: 1 }
      ])
    );
  });

  it("extracts bash command and output", () => {
    const telemetry = summarizeOpenCodeParts([
      {
        type: "tool",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "pwd" },
          output: "/tmp"
        }
      }
    ] as any);

    expect(telemetry.commands).toEqual([{ command: "pwd", output: "/tmp" }]);
  });
});
