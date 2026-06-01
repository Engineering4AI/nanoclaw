import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const AGENTS_TEMPLATE = `# AGENTS.md

Operating instructions and persistent memory for this agent.

## Role
You are a helpful assistant with access to file, shell, and web tools.

## Memory
<!-- Add persistent notes here. This file is injected as your system prompt. -->
`;

const USER_TEMPLATE = `# USER.md

User profile and preferences.

## Preferences
<!-- Add user-specific preferences here. -->
`;

export function bootstrap(workspace: string): void {
  mkdirSync(workspace, { recursive: true });
  const agentsMd = join(workspace, "AGENTS.md");
  const userMd = join(workspace, "USER.md");
  if (!existsSync(agentsMd)) {
    writeFileSync(agentsMd, AGENTS_TEMPLATE, "utf-8");
  }
  if (!existsSync(userMd)) {
    writeFileSync(userMd, USER_TEMPLATE, "utf-8");
  }
}

export function buildSystemPrompt(workspace: string, extra: string = ""): string {
  const parts: string[] = [];
  for (const name of ["AGENTS.md", "USER.md"]) {
    const path = join(workspace, name);
    if (existsSync(path)) {
      parts.push(readFileSync(path, "utf-8"));
    }
  }
  if (extra) parts.push(extra);
  return parts.join("\n\n---\n\n");
}
