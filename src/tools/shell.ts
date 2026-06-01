import { makeTool } from "./index.ts";
import type { Tool } from "./index.ts";

const DEFAULT_TIMEOUT = 120; // seconds

async function runBash(args: Record<string, unknown>): Promise<string> {
  const cmd = String(args["command"]);
  const timeout = typeof args["timeout"] === "number" ? (args["timeout"] as number) : DEFAULT_TIMEOUT;

  const proc = Bun.spawn(["bash", "-c", cmd], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const timeoutMs = timeout * 1000;
  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), timeoutMs),
  );

  const completePromise = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const result = await Promise.race([completePromise, timeoutPromise]);

  if (result === null) {
    proc.kill();
    return `[timeout after ${timeout}s]`;
  }

  const [stdout, stderr, exitCode] = result as [string, string, number];

  const parts: string[] = [];
  if (stdout) parts.push(stdout);
  if (stderr) parts.push(`[stderr]\n${stderr}`);
  if (exitCode !== 0) parts.push(`[exit ${exitCode}]`);
  return parts.join("\n") || "[no output]";
}

export const RUN_BASH: Tool = makeTool(
  "run_bash",
  "Execute a shell command and return stdout + stderr. Times out after 120s by default.",
  {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
      timeout: { type: "integer", description: "Timeout in seconds (default 120)" },
    },
    required: ["command"],
  },
  runBash,
);

export const SHELL_TOOLS: Tool[] = [RUN_BASH];
