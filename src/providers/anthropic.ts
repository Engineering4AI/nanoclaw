import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.ts";
import { Provider, makeStreamResponse } from "./base.ts";
import type { Message, ApiTool, StreamResponse, ToolUse } from "./base.ts";

const RETRY_STATUS = new Set([429, 529]);
const MAX_RETRIES = 5;

export class AnthropicProvider extends Provider {
  private readonly client: Anthropic;

  constructor(config: Config) {
    super();
    this.client = new Anthropic({ apiKey: config.apiKey || undefined });
  }

  async stream(messages: Message[], tools: ApiTool[], model: string): Promise<StreamResponse> {
    let delay = 1.0;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this._call(messages, tools, model);
      } catch (err) {
        if (err instanceof Anthropic.RateLimitError) {
          if (attempt === MAX_RETRIES - 1) throw err;
          console.warn(`Rate limited, retrying in ${delay.toFixed(1)}s`);
          await sleep(delay * 1000);
          delay = Math.min(delay * 2, 60);
          continue;
        }
        if (err instanceof Anthropic.APIStatusError && RETRY_STATUS.has(err.status)) {
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

  private async _call(messages: Message[], tools: ApiTool[], model: string): Promise<StreamResponse> {
    const kwargs: Record<string, unknown> = {
      model,
      max_tokens: 8192,
      messages: messages as unknown[],
    };

    if (tools.length > 0) {
      kwargs["tools"] = tools;
    }

    // extract system message if present
    let msgs = messages as unknown as Array<Record<string, unknown>>;
    if (msgs.length > 0 && msgs[0]!["role"] === "system") {
      kwargs["system"] = msgs[0]!["content"];
      kwargs["messages"] = msgs.slice(1);
    }

    const stream = this.client.messages.stream(kwargs as Parameters<typeof this.client.messages.stream>[0]);
    const msg = await stream.getFinalMessage();

    let text = "";
    const toolUses: ToolUse[] = [];

    for (const block of msg.content) {
      if (block.type === "text") {
        text = block.text;
      } else if (block.type === "tool_use") {
        toolUses.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    const stopReason =
      msg.stop_reason === "tool_use"
        ? "tool_use"
        : msg.stop_reason === "max_tokens"
          ? "max_tokens"
          : "end_turn";

    return makeStreamResponse(
      text,
      stopReason,
      toolUses,
      msg.usage.input_tokens,
      msg.usage.output_tokens,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
