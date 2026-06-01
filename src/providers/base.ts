export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolUseId: string;
  content: string;
  isError: boolean;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error: boolean };

export type Message = {
  role: "user" | "assistant" | "system";
  content: string | ContentBlock[];
};

export interface ApiTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface StreamResponse {
  text: string;
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  toolUses: ToolUse[];
  inputTokens: number;
  outputTokens: number;
  asAssistantMessage(): Message;
}

export function makeStreamResponse(
  text: string,
  stopReason: "end_turn" | "tool_use" | "max_tokens",
  toolUses: ToolUse[],
  inputTokens: number,
  outputTokens: number,
): StreamResponse {
  return {
    text,
    stopReason,
    toolUses,
    inputTokens,
    outputTokens,
    asAssistantMessage(): Message {
      const content: ContentBlock[] = [];
      if (text) {
        content.push({ type: "text", text });
      }
      for (const tu of toolUses) {
        content.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
      }
      return { role: "assistant", content };
    },
  };
}

export function toolResultsAsMessage(results: ToolResult[]): Message {
  return {
    role: "user",
    content: results.map((r) => ({
      type: "tool_result" as const,
      tool_use_id: r.toolUseId,
      content: r.content,
      is_error: r.isError,
    })),
  };
}

export abstract class Provider {
  abstract stream(
    messages: Message[],
    tools: ApiTool[],
    model: string,
  ): Promise<StreamResponse>;
}
