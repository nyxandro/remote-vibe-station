/**
 * @fileoverview Types for OpenCode HTTP responses (subset).
 *
 * Notes:
 * - OpenCode returns a rich `parts[]` array (tools, patches, reasoning, etc).
 * - We intentionally model only the fields we need for Telegram telemetry.
 * - Do not expose `reasoning.text` to Telegram; it may contain chain-of-thought.
 *
 * Exports:
 * - OpenCodeAssistantTokens (L18) - Token usage structure.
 * - OpenCodeAssistantInfo (L31) - Assistant message metadata (model/mode/agent/tokens).
 * - OpenCodePart (L58) - Discriminated union of relevant response parts.
 * - OpenCodePromptInputPart (L92) - Request part union for text and file attachments.
 * - OpenCodeMessageResponse (L109) - Response payload for POST /session/:id/message.
 * - OpenCodeCommand (L114) - Slash command metadata from GET /command.
 * - OpenCodeExecutionModel (L119) - Request model with optional thinking variant.
 * - OpenCodeProviderSummary (L125) - Provider metadata for Telegram pickers.
 * - OpenCodeProviderModel (L132) - Model metadata with variants.
 * - OpenCodeAgent (L138) - Agent metadata for Telegram picker.
 */

export type OpenCodeAssistantTokens = {
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
};

export type OpenCodeAssistantInfo = {
  id: string;
  sessionID: string;
  providerID: string;
  modelID: string;
  mode: string;
  agent: string;
  cost: number;
  tokens: OpenCodeAssistantTokens;
};

export type OpenCodeTextPart = {
  type: "text";
  text: string;
};

export type OpenCodeToolPart = {
  type: "tool";
  tool: string;
  state: string;
  metadata?: Record<string, unknown>;
};

export type OpenCodePatchPart = {
  type: "patch";
  hash: string;
  files: string[];
};

export type OpenCodeSubtaskPart = {
  type: "subtask";
  description: string;
  agent: string;
  command?: string;
  model?: { providerID: string; modelID: string };
};

export type OpenCodeAgentPart = {
  type: "agent";
  name: string;
};

export type OpenCodeStepStartPart = {
  type: "step-start";
};

export type OpenCodeStepFinishPart = {
  type: "step-finish";
  reason: string;
};

export type OpenCodePart =
  | OpenCodeTextPart
  | OpenCodeToolPart
  | OpenCodePatchPart
  | OpenCodeSubtaskPart
  | OpenCodeAgentPart
  | OpenCodeStepStartPart
  | OpenCodeStepFinishPart
  | { type: string; [key: string]: unknown };

export type OpenCodePromptInputPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "file";
      mime: string;
      url: string;
      filename: string;
    };

export type OpenCodeMessageResponse = {
  info: OpenCodeAssistantInfo;
  parts: OpenCodePart[];
};

export type OpenCodeCommand = {
  name: string;
  description?: string;
};

export type OpenCodeExecutionModel = {
  providerID: string;
  modelID: string;
  variant?: string;
};

export type OpenCodeProviderSummary = {
  id: string;
  name: string;
  connected: boolean;
  defaultModelID?: string;
};

export type OpenCodeProviderModel = {
  id: string;
  name: string;
  variants: string[];
};

export type OpenCodeAgent = {
  name: string;
  description?: string;
  mode?: string;
};
