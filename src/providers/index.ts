import type { Config } from "../config.ts";
import { Provider } from "./base.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { OpenAIProvider } from "./openai.ts";

export { Provider } from "./base.ts";
export type { StreamResponse, Message, ApiTool, ToolUse, ToolResult, ContentBlock } from "./base.ts";
export { makeStreamResponse, toolResultsAsMessage } from "./base.ts";

export function getProvider(config: Config): Provider {
  switch (config.provider) {
    case "anthropic":
      return new AnthropicProvider(config);
    case "openai":
    case "openai_compatible":
      return new OpenAIProvider(config);
    default:
      // default to openai-compatible (works with OpenRouter)
      return new OpenAIProvider(config);
  }
}
