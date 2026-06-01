import { homedir } from "os";
import { join } from "path";
import type { Config } from "../config.ts";
import { bootstrap, buildSystemPrompt } from "../memory/workspace.ts";
import { PermissionPolicy, PermissionRequired } from "../permissions.ts";
import { run as agentRun } from "../agent/loop.ts";
import { SessionStore } from "./session.ts";

const MAX_CHUNK = 1000; // chars per block when streaming long responses

export type DeliverFn = (peerId: string, text: string) => Promise<void>;
export type OnMessageFn = (
  channel: string,
  peerId: string,
  text: string,
  deliver: DeliverFn,
) => Promise<void>;

// One-lock-per-peer using promise chaining (no external dep needed)
const _locks = new Map<string, Promise<void>>();

function withLock(key: string, fn: () => Promise<void>): Promise<void> {
  // Drop (not queue) if lock is already held
  const current = _locks.get(key);
  if (current !== undefined) {
    // Check if still pending by seeing if an entry exists
    // We use a sentinel approach: if the key exists, it's busy
    console.log(`Dropping message from ${key} — turn already in progress`);
    return Promise.resolve();
  }

  let resolve!: () => void;
  const next = new Promise<void>((r) => {
    resolve = r;
  });
  _locks.set(key, next);

  const run = async (): Promise<void> => {
    try {
      await fn();
    } finally {
      _locks.delete(key);
      resolve();
    }
  };

  return run();
}

function chunkResponse(text: string, maxChars: number = MAX_CHUNK): string[] {
  if (text.length <= maxChars) return [text];

  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}`.trim() : para;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = para;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export class Router {
  private readonly store: SessionStore;

  constructor(private readonly config: Config) {
    const dbPath = join(homedir(), ".nanoclaw", "gateway.db");
    this.store = new SessionStore(dbPath);
    bootstrap(config.workspace);
  }

  async onMessage(
    channel: string,
    peerId: string,
    text: string,
    deliver: DeliverFn,
  ): Promise<void> {
    const key = `${channel}:${peerId}`;

    await withLock(key, async () => {
      const session = this.store.getOrCreate(peerId, channel);
      const systemPrompt = buildSystemPrompt(this.config.workspace);

      if (session.messages.length === 0) {
        session.messages.push({ role: "system", content: systemPrompt });
      }

      session.messages.push({ role: "user", content: text });

      const policy = PermissionPolicy.fromMode(this.config.permissionMode);

      let response: string;
      try {
        response = await agentRun(session.messages, this.config, {
          sessionId: session.id,
          policy,
        });
      } catch (err) {
        if (err instanceof PermissionRequired) {
          response = `[Permission required for ${err.tool} — switch to auto mode or approve explicitly]`;
        } else {
          console.error(`Agent error for ${key}:`, err);
          response = `[Error: ${err instanceof Error ? err.message : String(err)}]`;
        }
      }

      session.messages.push({ role: "assistant", content: response });
      this.store.save(session);

      for (const chunk of chunkResponse(response)) {
        await deliver(peerId, chunk);
      }
    });
  }
}
