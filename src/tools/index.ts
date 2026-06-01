import type { PermissionPolicy } from "../permissions.ts";
import type { ToolResult, ApiTool } from "../providers/base.ts";
import * as hooks from "../hooks.ts";

export type { ToolResult } from "../providers/base.ts";

const LARGE_OUTPUT_THRESHOLD = 50_000; // bytes

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<string>;
  asApiDict(): ApiTool;
  run(
    toolUseId: string,
    args: Record<string, unknown>,
    policy: PermissionPolicy,
  ): Promise<ToolResult>;
}

export function makeTool(
  name: string,
  description: string,
  inputSchema: Record<string, unknown>,
  execute: (args: Record<string, unknown>) => Promise<string>,
): Tool {
  return {
    name,
    description,
    inputSchema,
    execute,

    asApiDict(): ApiTool {
      return {
        name: this.name,
        description: this.description,
        input_schema: this.inputSchema,
      };
    },

    async run(
      toolUseId: string,
      args: Record<string, unknown>,
      policy: PermissionPolicy,
    ): Promise<ToolResult> {
      // permission check
      try {
        policy.check(this.name, args);
      } catch (err) {
        return {
          toolUseId,
          content: String(err instanceof Error ? err.message : err),
          isError: true,
        };
      }

      // pre_hook → execute → post_hook
      try {
        await hooks.pre(this.name, args);
        let result = await this.execute(args);
        await hooks.post(this.name, args, result);

        // truncate large output
        const byteLen = new TextEncoder().encode(result).length;
        if (byteLen > LARGE_OUTPUT_THRESHOLD) {
          result =
            result.slice(0, LARGE_OUTPUT_THRESHOLD) +
            `\n[... truncated at ${LARGE_OUTPUT_THRESHOLD} bytes]`;
        }

        return { toolUseId, content: result, isError: false };
      } catch (err) {
        console.error(`Tool ${this.name} failed:`, err);
        return {
          toolUseId,
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
          isError: true,
        };
      }
    },
  };
}

export async function executeParallel(
  toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }>,
  registry: Map<string, Tool>,
  policy: PermissionPolicy,
): Promise<ToolResult[]> {
  const tasks = toolUses.map((tu) => {
    const tool = registry.get(tu.name);
    if (!tool) {
      return Promise.resolve<ToolResult>({
        toolUseId: tu.id,
        content: `Unknown tool: ${tu.name}`,
        isError: true,
      });
    }
    return tool.run(tu.id, tu.input, policy);
  });
  return Promise.all(tasks);
}

export function buildRegistry(tools: Tool[]): Map<string, Tool> {
  const registry = new Map<string, Tool>();
  for (const tool of tools) {
    registry.set(tool.name, tool);
  }
  return registry;
}
