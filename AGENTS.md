# NanoClaw TypeScript Rewrite — Design Specification

**Stack:** Bun + TypeScript + React Ink  
**Target:** ~2,000 lines, same architecture as the Python version, zero non-source files changed.

---

## Runtime & Tooling

| Concern | Choice | Reason |
|---------|--------|--------|
| Runtime | **Bun** | Native TS execution, built-in SQLite (`bun:sqlite`), built-in test runner, fast startup |
| Language | **TypeScript** (strict) | Type safety without a build step in Bun |
| TUI | **React Ink** | Terminal UI for the interactive REPL / debug view |
| Package manager | `bun install` | Lockfile: `bun.lockb` |
| Test runner | `bun test` | Drop-in jest-compatible, no extra config |
| Linter | `biome` | Replaces ruff; single binary, fast |
| Entry point | `bun run src/main.ts` or `bun src/main.ts` | Mirrors `python -m nanoclaw` |

---

## Directory Layout

Exact 1-to-1 mapping with the Python source. Every file has one job.

```
src/
  main.ts                      # __main__.py  — reads env, starts gateway, starts cron
  config.ts                    # config.py    — Config interface + YAML load
  cron.ts                      # CronScheduler — interval/cron-expr jobs, parseCronEnv()
  permissions.ts               # permissions.py — PermissionPolicy, 3 modes
  hooks.ts                     # hooks.py     — pre/post hook registry

  providers/
    base.ts                    # Provider ABC, StreamResponse, ToolUse, ToolResult
    anthropic.ts               # AnthropicProvider — backoff on 429/529
    openai.ts                  # OpenAIProvider — converts tool schema to OpenAI format
    index.ts                   # getProvider() factory

  tools/
    index.ts                   # Tool type, executeParallel(), buildRegistry()
    files.ts                   # readFile, writeFile, editFile
    shell.ts                   # runBash (120s timeout)
    web.ts                     # webFetch (HTML stripped), webSearch (DuckDuckGo)

  agent/
    loop.ts                    # run() — the agent loop
    compactor.ts               # compact when estimated tokens > 80% context window
    session.ts                 # JSONL append-only persistence per session_id

  memory/
    workspace.ts               # bootstrap AGENTS.md/USER.md, build system prompt

  gateway/
    index.ts                   # GatewayConfig, start()
    session.ts                 # SessionStore — bun:sqlite-backed
    router.ts                  # onMessage → lock → agent loop → chunk → deliver
    adapters/
      base.ts                  # ChannelAdapter abstract class
      telegram.ts              # grammy polling
      slack.ts                 # @slack/bolt socket mode
      discord.ts               # discord.js intents

  ui/
    App.tsx                    # React Ink root — gateway log + active sessions view
    SessionPanel.tsx           # Per-session message stream
    StatusBar.tsx              # Model · permission mode · uptime
```

---

## Type Definitions (`providers/base.ts`)

Direct translation of the Python dataclasses:

```typescript
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

export interface StreamResponse {
  text: string;
  stopReason: "end_turn" | "tool_use" | "max_tokens";
  toolUses: ToolUse[];
  inputTokens: number;
  outputTokens: number;
  asAssistantMessage(): Message;
}

export type Message = {
  role: "user" | "assistant" | "system";
  content: string | ContentBlock[];
};

export abstract class Provider {
  abstract stream(
    messages: Message[],
    tools: ApiTool[],
    model: string
  ): Promise<StreamResponse>;
}
```

---

## Config (`config.ts`)

```typescript
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";  // npm: yaml

export interface Config {
  model: string;            // default: "anthropic/claude-sonnet-4-6"
  provider: string;         // "anthropic" | "openai" | "openai_compatible"
  apiKey: string;
  baseUrl: string;          // default: "https://openrouter.ai/api/v1"
  maxTokens: number;        // default: 8192
  maxIterations: number;    // default: 40
  workspace: string;        // default: "~/.nanoclaw/workspace"
  sessionsDir: string;      // default: "~/.nanoclaw/sessions"
  permissionMode: string;   // "default" | "auto" | "plan"
  webProxy: string;
  cronJobs: string;         // raw NANOCLAW_CRON value; parsed by parseCronEnv()
}
```

Load order: YAML file → env overrides. Env vars are identical to Python version (`NANOCLAW_MODEL`, `ANTHROPIC_API_KEY`, etc.).

Dependency: `npm: yaml` (pure JS YAML parser — same format as Python's ruamel/PyYAML).

---

## Permissions (`permissions.ts`)

```typescript
export enum PermissionMode { DEFAULT = "default", AUTO = "auto", PLAN = "plan" }

export class PermissionDenied extends Error {}
export class PermissionRequired extends Error {
  constructor(public tool: string, public args: Record<string, unknown>) {
    super(`Permission required for ${tool}`);
  }
}

export class PermissionPolicy {
  check(tool: string, args: Record<string, unknown>): void { /* ... */ }
}
```

Sensitive path guard uses `micromatch` (npm) instead of Python's `fnmatch` — same glob syntax.

Security invariants are identical to Python:
- `webFetch`/`webSearch`: never read `HTTP_PROXY` from env. Proxy only via `NANOCLAW_WEB_PROXY`.
- Block `~/.ssh/*`, `~/.aws/*`, `~/.config/*/credentials`, `~/.gnupg/*`, `~/.netrc`.
- `deniedCommands` prefix check: `"rm -rf /"` blocks `rm -rf /tmp/` too.

---

## Tool System (`tools/index.ts`)

```typescript
export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
  execute(args: Record<string, unknown>): Promise<string>;
  asApiDict(): ApiTool;
  run(toolUseId: string, args: Record<string, unknown>, policy: PermissionPolicy): Promise<ToolResult>;
}
```

`run()` pipeline is always: `policy.check → hooks.pre → execute → hooks.post → result`.  
Large output (>50 KB) truncated — same threshold as Python.

`executeParallel()` uses `Promise.all()` directly — Bun handles concurrency natively.

### Tool implementations

| File | Tool names | Key dependency |
|------|-----------|----------------|
| `tools/files.ts` | `read_file`, `write_file`, `edit_file` | `fs` (Bun built-in) |
| `tools/shell.ts` | `run_bash` | `Bun.spawn()`, 120s timeout |
| `tools/web.ts` | `web_fetch`, `web_search` | `fetch` (built-in), `node-html-parser` for HTML stripping, DuckDuckGo HTML scrape |

`webFetch` uses native `fetch` with no proxy env inheritance (call with explicit `dispatcher` only when `NANOCLAW_WEB_PROXY` is set, using `undici.ProxyAgent`).

---

## Agent Loop (`agent/loop.ts`)

Mirrors Python `agent/loop.py:run()` exactly:

```typescript
export async function run(
  messages: Message[],
  config: Config,
  opts?: { extraTools?: Tool[]; sessionId?: string; policy?: PermissionPolicy }
): Promise<string> {
  const provider = getProvider(config);
  const tools = [...defaultTools(), ...(opts?.extraTools ?? [])];
  const registry = buildRegistry(tools);
  const apiTools = tools.map(t => t.asApiDict());
  const policy = opts?.policy ?? PermissionPolicy.fromMode(config.permissionMode);
  const ctxWindow = contextWindow(config.model);

  for (let i = 0; i < config.maxIterations; i++) {
    if (needsCompaction(messages, ctxWindow))
      messages = await compact(messages, provider, config.model);

    const response = await provider.stream(messages, apiTools, config.model);
    messages.push(response.asAssistantMessage());
    if (opts?.sessionId) appendTurn(config.sessionsDir, opts.sessionId, [response.asAssistantMessage()]);

    if (response.stopReason !== "tool_use") return response.text;
    if (response.inputTokens + response.outputTokens >= config.maxTokens)
      return response.text || "[max tokens reached]";

    const results = await executeParallel(response.toolUses, registry, policy);
    const toolMsg = toolResultsAsMessage(results);
    messages.push(toolMsg);
    if (opts?.sessionId) appendTurn(config.sessionsDir, opts.sessionId, [toolMsg]);
  }
  return "[max iterations reached]";
}
```

---

## Compactor (`agent/compactor.ts`)

Token estimation: `Math.floor(chars / 4)` — same as Python.  
Threshold: 80% of context window.  
Keeps: `messages[0]` (system prompt) + last 4 turns.  
Summarizes: `messages[1..N-5]` via a second `provider.stream()` call with a summary prompt.

---

## Session Persistence (`agent/session.ts`)

Append-only JSONL, one file per `session_id` under `~/.nanoclaw/sessions/`.  
Uses `Bun.file().writer()` (append mode) for non-blocking writes.

---

## Gateway Session Store (`gateway/session.ts`)

Uses `bun:sqlite` — Bun's built-in SQLite binding, no external dep.

```typescript
import { Database } from "bun:sqlite";

// Two-table schema: sessions (metadata) + messages (append-only rows)
const SESSIONS_DDL = `
  CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    peer_id     TEXT NOT NULL,
    channel     TEXT NOT NULL,
    last_active TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_peer_channel ON sessions(peer_id, channel);
`;

const MESSAGES_DDL = `
  CREATE TABLE IF NOT EXISTS messages (
    session_id TEXT NOT NULL,
    seq        INTEGER NOT NULL,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    PRIMARY KEY (session_id, seq),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );
`;
```

`save()` only inserts **new messages** (tracked via an in-memory `flushedCount` map) and runs fire-and-forget via `queueMicrotask` — O(1) per turn regardless of history length.

Auto-migration: on startup, if the old `messages TEXT` column exists on `sessions`, the store recreates the table and migrates blobs into rows transparently.

Session expiry logic (idle hours + daily reset at 04:00) is identical.

---

## Gateway Router (`gateway/router.ts`)

Per-peer lock: use a `Map<string, Promise<void>>` mutex chain — the idiomatic JS pattern replacing `asyncio.Lock`:

```typescript
// One-lock-per-peer using promise chaining (no external dep needed)
const _locks = new Map<string, Promise<void>>();

async function withLock(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = _locks.get(key) ?? Promise.resolve();
  let resolve!: () => void;
  const next = new Promise<void>(r => { resolve = r; });
  _locks.set(key, next);
  try {
    await prev;
    await fn();
  } finally {
    resolve();
  }
}
```

Drop (not queue) if lock is already held — same behavior as Python.  
`_chunkResponse()` logic is identical: split at `\n\n` boundaries, ≤1000 chars per chunk.

---

## Providers

### `providers/anthropic.ts`

Dependency: `@anthropic-ai/sdk`  
Streaming: use `client.messages.stream()`, collect `text` deltas and `tool_use` blocks.  
Retry: exponential backoff on HTTP 429 / 529 — `waitAndRetry(attempt)` with jitter, max 5 retries.

### `providers/openai.ts`

Dependency: `openai`  
Converts Anthropic `input_schema` → OpenAI `parameters` (rename key, same JSON Schema body).  
Streaming: `client.chat.completions.stream()`, collect delta chunks.

---

## Chat Adapters

| Adapter | Library | Notes |
|---------|---------|-------|
| `adapters/telegram.ts` | `grammy` | Polling mode (`bot.start()`); send via `ctx.reply()` |
| `adapters/slack.ts` | `@slack/bolt` | Socket mode; send via `client.chat.postMessage()` |
| `adapters/discord.ts` | `discord.js` | `GatewayIntentBits.MessageContent`; send via `message.channel.send()` |

Each adapter implements exactly two methods:

```typescript
abstract class ChannelAdapter {
  abstract start(onMessage: OnMessageFn): Promise<void>;
  abstract send(peerId: string, text: string): Promise<void>;
}
```

---

## React Ink UI (`ui/`)

Shown only when running interactively (not when started as a background daemon). Renders:

- **StatusBar**: current model · permission mode · uptime · active peer count
- **SessionPanel**: scrollable log of the last N messages per active session
- **App**: combines panels, keyboard `q` to quit

```typescript
// src/ui/App.tsx
import { Box, Text, useApp } from "ink";

export function App({ gateway }: { gateway: GatewayState }) {
  const { exit } = useApp();
  useInput((_, key) => { if (key.escape || input === "q") exit(); });

  return (
    <Box flexDirection="column">
      <StatusBar model={gateway.model} mode={gateway.permissionMode} />
      {gateway.sessions.map(s => <SessionPanel key={s.id} session={s} />)}
    </Box>
  );
}
```

The gateway emits events to a shared `GatewayState` store (simple `EventEmitter`); Ink re-renders on each event. UI is purely presentational — all logic stays in `gateway/router.ts`.

---

## Dependencies

```jsonc
// package.json (abridged)
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.52",
    "openai": "^5",
    "yaml": "^2",           // config file parsing
    "micromatch": "^4",     // glob matching for permission path rules
    "node-html-parser": "^7", // HTML stripping in web_fetch
    "undici": "^7",         // ProxyAgent for opt-in web proxy
    "grammy": "^1",         // Telegram adapter
    "@slack/bolt": "^4",    // Slack adapter
    "discord.js": "^14",    // Discord adapter
    "ink": "^5",            // React Ink TUI
    "react": "^18"          // Ink peer dep
  },
  "devDependencies": {
    "@biomejs/biome": "^2",
    "@types/micromatch": "^4",
    "@types/react": "^18",
    "typescript": "^5"
  }
}
```

Optional adapters installable separately — mirror Python's extras:

```bash
bun install                    # core only
bun install grammy             # + Telegram
bun install @slack/bolt        # + Slack
bun install discord.js         # + Discord
```

---

## Cron Scheduler (`cron.ts`)

Enabled via `NANOCLAW_CRON` env var. Format: semicolon-separated entries, each `SCHEDULE|PROMPT[|label]`.

```
NANOCLAW_CRON=30m|check disk usage and warn if >90%|disk;1h|summarize ~/app.log errors|logs
```

Schedule formats supported:

| Format | Example | Meaning |
|--------|---------|---------|
| Interval | `30m`, `2h`, `90s` | Every N minutes/hours/seconds |
| Cron (every N min) | `*/5 * * * *` | Every 5 minutes |
| Cron (every N hours) | `0 */2 * * *` | Every 2 hours |

`parseCronEnv(raw)` splits on `;`, returns `CronJob[]`.  
`CronScheduler.start()` calls `setInterval` per job — no external dep.  
Cron jobs always run in `auto` permission mode (unattended; no interactive prompt possible).

---

## Invariants Preserved from Python Version

1. **Agent loop owns nothing but its own turn** — `run()` takes `messages` + `Config`, returns `string`. No session/routing knowledge.
2. **Tool pipeline always**: `permission_check → pre_hook → execute → post_hook → result`. No bypasses.
3. **Permissions raise, never block silently** — `PermissionDenied` (hard stop) vs `PermissionRequired` (caller decides).
4. **`webFetch`/`webSearch` never inherit `HTTP_PROXY`** — proxy only via `NANOCLAW_WEB_PROXY` env var; embedded credentials in proxy URL rejected.
5. **Compaction at 80%** — keeps system prompt + last 4 turns, summarizes the middle via a second LLM call.
6. **One lock per peer** — drop (not queue) concurrent messages. Prevents pile-up.
7. **Sessions survive restarts** — SQLite via `bun:sqlite`; JSONL audit trail per session.
8. **Block streaming** — ≤1000 chars per chunk, split at `\n\n`. Required for Telegram 4096-char limit.
9. **Each agent run is an OS process** — no in-process subagent spawning. Coordination state lives outside the process.
10. **Cron always runs in `auto` mode** — no interactive permission prompts; jobs must be safe to execute unattended.

---

## Implementation Order

1. `src/config.ts` + `src/permissions.ts` — pure logic, no I/O, easy to unit-test
2. `src/providers/base.ts` + `src/providers/anthropic.ts` + `src/providers/openai.ts`
3. `src/tools/` — files, shell, web
4. `src/agent/loop.ts` + `src/agent/compactor.ts` + `src/agent/session.ts`
5. `src/memory/workspace.ts`
6. `src/gateway/session.ts` + `src/gateway/router.ts` + `src/gateway/index.ts`
7. `src/gateway/adapters/` — telegram, slack, discord
8. `src/ui/` — React Ink TUI (can be stubbed as a plain console logger until step 7 is done)
9. `src/cron.ts` — CronScheduler, parseCronEnv
10. `src/main.ts` — wire everything together

---

## What Does NOT Change

- `README.md`, `.env.example`, `pyproject.toml`, `.gitignore` — untouched
- `~/.nanoclaw/` runtime directory layout — identical schema; SQLite DB and JSONL files are forward-compatible
- Environment variable names — no renames; existing `.env` files work unchanged
