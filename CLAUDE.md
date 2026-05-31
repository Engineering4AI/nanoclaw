# NanoClaw — Implementation Keynotes

## What Was Built

~1,500 lines of Python across 18 files. Every file has one job.

```
nanoclaw/
  __main__.py             # gateway entry: reads env vars, starts adapters
  config.py               # Config dataclass + YAML load (env overrides apply last)
  permissions.py          # PermissionPolicy, 3 modes, sensitive-path guard
  hooks.py                # pre/post hook registry (empty by default)
  providers/
    base.py               # Provider ABC, StreamResponse, ToolUse, ToolResult
    anthropic.py          # AnthropicProvider — exponential backoff on 429/529
    openai.py             # OpenAIProvider — converts Anthropic tool schema to OpenAI format
  tools/
    __init__.py           # Tool dataclass, parallel dispatch, 50KB output truncation
    files.py              # read_file, write_file, edit_file
    shell.py              # run_bash (120s timeout, captures stdout+stderr+exit code)
    web.py                # web_fetch (HTML stripped), web_search (DuckDuckGo)
  agent/
    loop.py               # run() — the agent loop
    compactor.py          # compact when estimated tokens > 80% of context window
    session.py            # JSONL append-only persistence per session_id
  memory/
    workspace.py          # bootstrap AGENTS.md/USER.md, build system prompt
  gateway/
    __init__.py           # GatewayConfig, start()
    session.py            # SessionStore — SQLite-backed, per-peer or per-channel-peer
    router.py             # on_message → lock → agent loop → chunk → deliver
    adapters/
      base.py             # ChannelAdapter ABC (start + send)
      telegram.py         # python-telegram-bot polling
      slack.py            # slack_bolt socket mode
      discord.py          # discord.py intents
```

---

## Key Design Decisions

### Agent loop owns nothing but its own turn
`agent/loop.py:run()` takes a `messages` list and a `Config`. It does not know about sessions, routing, or platforms. The gateway passes the full message history in and gets a string back.

### Tool pipeline is always the same
Every tool call goes: `permission_check → pre_hook → execute → post_hook → result`. No tool bypasses this. Implemented in `tools/__init__.py:Tool.run()`.

### Permissions raise, they don't block silently
- `PermissionDenied` — hard block (PLAN mode, sensitive path, denied command prefix)
- `PermissionRequired` — DEFAULT mode write/shell; caller handles the confirmation prompt
The kernel has no TTY dependency; the router in `gateway/router.py` catches `PermissionRequired` and returns a message to the user.

### web_fetch/web_search: trust_env=False
`httpx.AsyncClient(trust_env=False)` — never inherits `HTTP_PROXY` from environment. Proxy only via `NANOCLAW_WEB_PROXY` env var. Embedded credentials in proxy URL are rejected.

### Context compaction at 80%
`agent/compactor.py` estimates tokens (chars ÷ 4), triggers when >80% of context window. Summarizes turns `[1..-5]` into a single `[SUMMARY]` message via a second LLM call. Keeps system prompt and last 4 turns intact.

### Gateway: one lock per peer
`gateway/router.py` maintains an `asyncio.Lock` per `(channel, peer_id)`. If a turn is already running, the next message is dropped (not queued). Prevents pile-up.

### Session scope is configurable
Default `per-peer`: one session per user across all channels. Set `per-channel-peer` for separate context per group chat. Controlled by `GatewayConfig.session_scope`.

### Sessions survive restarts
`gateway/session.py` is SQLite-backed. In-memory cache is warm path; SQLite is the persistent source. `agent/session.py` appends every turn to a JSONL file under `~/.nanoclaw/sessions/` as an audit trail, but recovery uses SQLite — `load_session()` exists but is not called by the router.

### Block streaming prevents platform truncation
`gateway/router.py:_chunk_response()` splits at paragraph boundaries into ≤1000-char chunks. Required for Telegram (4096-char hard limit per message).

### No CLI adapter
This is a gateway agent, not a CLI tool. Adapters are Telegram, Slack, Discord. Adding a new platform means implementing two methods: `start(on_message)` and `send(peer_id, text)`.

---

## Running

```bash
cp .env.example .env              # fill in your keys
pip install -e ".[telegram]"      # or [slack] / [discord]
python -m nanoclaw
```

Config file at `~/.nanoclaw/config.yaml` is created on first run. Workspace files (`AGENTS.md`, `USER.md`) are bootstrapped at `~/.nanoclaw/workspace/`.

---

## What Is Intentionally Not Here

| Feature | Add when |
|---------|----------|
| Cron scheduler | You need recurring tasks — use `crontab` calling `nanoclaw` directly |
| Multi-agent board | You have >1 agent profile and need coordination |
| MCP servers | You hit a tool gap not coverable by the 6 kernel tools |
| Skills/macros | `AGENTS.md` handles procedural memory at this scale |
| Dashboard/TUI | Gateway is the interface; a dashboard is orthogonal |
| Trajectory recording | You need RL training data |
