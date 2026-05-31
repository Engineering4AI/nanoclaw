from __future__ import annotations

import asyncio

from . import Tool

_TIMEOUT = 120  # seconds


async def _run_bash(args: dict) -> str:
    cmd = args["command"]
    timeout = args.get("timeout", _TIMEOUT)
    proc = await asyncio.create_subprocess_shell(
        cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return f"[timeout after {timeout}s]"

    out = stdout.decode(errors="replace")
    err = stderr.decode(errors="replace")
    parts = []
    if out:
        parts.append(out)
    if err:
        parts.append(f"[stderr]\n{err}")
    if proc.returncode != 0:
        parts.append(f"[exit {proc.returncode}]")
    return "\n".join(parts) or "[no output]"


RUN_BASH = Tool(
    name="run_bash",
    description="Execute a shell command and return stdout + stderr. Times out after 120s by default.",
    input_schema={
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "Shell command to execute"},
            "timeout": {"type": "integer", "description": "Timeout in seconds (default 120)"},
        },
        "required": ["command"],
    },
    execute=_run_bash,
)

SHELL_TOOLS = [RUN_BASH]
