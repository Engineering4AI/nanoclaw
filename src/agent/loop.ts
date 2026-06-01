import type { Config } from "../config.ts";
import type { Message } from "../providers/base.ts";
import { toolResultsAsMessage } from "../providers/base.ts";
import { getProvider } from "../providers/index.ts";
import { PermissionPolicy } from "../permissions.ts";
import type { Tool } from "../tools/index.ts";
import { executeParallel, buildRegistry } from "../tools/index.ts";
import { FILE_TOOLS } from "../tools/files.ts";
import { SHELL_TOOLS } from "../tools/shell.ts";
import { WEB_TOOLS } from "../tools/web.ts";
import { needsCompaction, compact } from "./compactor.ts";
import { appendTurn } from "./session.ts";

const CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus": 200_000,
  "claude-sonnet": 200_000,
  "claude-haiku": 200_000,
  "gpt-4": 128_000,
  "gpt-5": 128_000,
  default: 128_000,
};

function contextWindow(model: string): number {
  for (const [prefix, size] of Object.entries(CONTEXT_WINDOWS)) {
    if (model.includes(prefix)) return size;
  }
  return CONTEXT_WINDOWS["default"]!;
}

export function defaultTools(): Tool[] {
  return [...FILE_TOOLS, ...SHELL_TOOLS, ...WEB_TOOLS];
}

export interface RunOptions {
  extraTools?: Tool[];
  sessionId?: string;
  policy?: PermissionPolicy;
}

export async function run(
  messages: Message[],
  config: Config,
  opts?: RunOptions,
): Promise<string> {
  const provider = getProvider(config);
  const tools = [...defaultTools(), ...(opts?.extraTools ?? [])];
  const registry = buildRegistry(tools);
  const apiTools = tools.map((t) => t.asApiDict());
  const policy = opts?.policy ?? PermissionPolicy.fromMode(config.permissionMode);
  const ctxWindow = contextWindow(config.model);

  for (let i = 0; i < config.maxIterations; i++) {
    // compact if approaching context limit
    if (needsCompaction(messages, ctxWindow)) {
      messages = await compact(messages, provider, config.model);
    }

    const response = await provider.stream(messages, apiTools, config.model);
    const assistantMsg = response.asAssistantMessage();
    messages.push(assistantMsg);

    if (opts?.sessionId) {
      await appendTurn(config.sessionsDir, opts.sessionId, [assistantMsg]);
    }

    console.debug(
      `iter=${i} stop=${response.stopReason} tokens_in=${response.inputTokens} tokens_out=${response.outputTokens}`,
    );

    if (response.stopReason !== "tool_use") {
      return response.text;
    }

    if (response.inputTokens + response.outputTokens >= config.maxTokens) {
      console.warn(`Token limit reached at iteration ${i}`);
      return response.text || "[max tokens reached]";
    }

    const results = await executeParallel(response.toolUses, registry, policy);
    const toolMsg = toolResultsAsMessage(results);
    messages.push(toolMsg);

    if (opts?.sessionId) {
      await appendTurn(config.sessionsDir, opts.sessionId, [toolMsg]);
    }
  }

  return "[max iterations reached]";
}
