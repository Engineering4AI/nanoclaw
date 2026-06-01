import { mkdirSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import type { Message } from "../providers/base.ts";

export function newSessionId(): string {
  return randomUUID();
}

export async function appendTurn(
  sessionsDir: string,
  sessionId: string,
  messages: Message[],
): Promise<void> {
  mkdirSync(sessionsDir, { recursive: true });
  const path = join(sessionsDir, `${sessionId}.jsonl`);
  const file = Bun.file(path);
  const writer = file.writer({ flags: "a" });
  for (const msg of messages) {
    writer.write(JSON.stringify(msg, null) + "\n");
  }
  await writer.end();
}

export function loadSession(sessionsDir: string, sessionId: string): Message[] {
  const path = join(sessionsDir, `${sessionId}.jsonl`);
  if (!existsSync(path)) return [];

  const content = require("fs").readFileSync(path, "utf-8") as string;
  const messages: Message[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) {
      messages.push(JSON.parse(trimmed) as Message);
    }
  }
  return messages;
}
