import OpenAI from "openai";
import type { Config } from "../config.ts";
import { Provider, makeStreamResponse } from "./base.ts";
import type { Message, ApiTool, StreamResponse, ToolUse, ContentBlock } from "./base.ts";

const MAX_RETRIES = 5;

export class OpenAIProvider extends Provider {
  private readonly client: OpenAI;

  constructor(config: Config) {
    super();
    const opts: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey: config.apiKey || undefined,
    };
    if (config.baseUrl) {
      opts.baseURL = config.baseUrl;
    }
    this.client = new OpenAI(opts);
  }

  async stream(messages: Message[], tools: ApiTool[], model: string): Promise<StreamResponse> {
    let delay = 1.0;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this._call(messages, tools, model);
      } catch (err) {
        if (err instanceof OpenAI.RateLimitError) {
          if (attempt === MAX_RETRIES - 1) throw err;
          await sleep(delay * 1000);
          delay = Math.min(delay * 2, 60);
          continue;
        }
        throw err;
      }
    }
    throw new Error("unreachable");
  }

  private static convertMessages(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
    const out: OpenAI.ChatCompletionMessageParam[] = [];

    for (const msg of messages) {
      const { role, content } = msg;

      if (typeof content === "string") {
        out.push({ role: role as "user" | "assistant" | "system", content });
        continue;
      }

      // list content blocks
      if (role === "assistant") {
        const textParts = (content as ContentBlock[])
          .filter((b) => b.type === "text")
          .map((b) => (b as { type: "text"; text: string }).text)
          .join(" ");

        const toolCalls = (content as ContentBlock[])
          .filter((b) => b.type === "tool_use")
          .map((b) => {
            const tu = b as { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
            return {
              id: tu.id,
              type: "function" as const,
              function: {
                name: tu.name,
                arguments: JSON.stringify(tu.input),
              },
            };
          });

        const entry: OpenAI.ChatCompletionAssistantMessageParam = {
          role: "assistant",
          content: textParts || null,
        };
        if (toolCalls.length > 0) {
          entry.tool_calls = toolCalls;
        }
        out.push(entry);
      } else if (role === "user") {
        const toolResults = (content as ContentBlock[]).filter((b) => b.type === "tool_result");
        if (toolResults.length > 0) {
          for (const b of toolResults) {
            const tr = b as { type: "tool_result"; tool_use_id: string; content: string };
            out.push({
              role: "tool",
              tool_call_id: tr.tool_use_id,
              content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content),
            });
          }
        } else {
          const text = (content as ContentBlock[])
            .filter((b) => b.type === "text")
            .map((b) => (b as { type: "text"; text: string }).text)
            .join(" ");
          out.push({ role: "user", content: text });
        }
      } else {
        out.push({ role: role as "system", content: typeof content === "string" ? content : JSON.stringify(content) });
      }
    }

    return out;
  }

  private async _call(messages: Message[], tools: ApiTool[], model: string): Promise<StreamResponse> {
    const params: OpenAI.ChatCompletionCreateParams = {
      model,
      messages: OpenAIProvider.convertMessages(messages),
      stream: false,
    };

    if (tools.length > 0) {
      params.tools = tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description ?? "",
          parameters: t.input_schema as Record<string, unknown>,
        },
      }));
      params.tool_choice = "auto";
    }

    const resp = await this.client.chat.completions.create(params);
    const choice = resp.choices[0]!;
    const msg = choice.message;

    const text = msg.content ?? "";
    const toolUses: ToolUse[] = [];

    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        toolUses.push({
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
        });
      }
    }

    let stopReason: "end_turn" | "tool_use" | "max_tokens" = "end_turn";
    if (toolUses.length > 0) stopReason = "tool_use";
    if (choice.finish_reason === "length") stopReason = "max_tokens";

    const usage = resp.usage;
    return makeStreamResponse(
      text,
      stopReason,
      toolUses,
      usage?.prompt_tokens ?? 0,
      usage?.completion_tokens ?? 0,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
