from __future__ import annotations

from pathlib import Path

_AGENTS_TEMPLATE = """\
# AGENTS.md

Operating instructions and persistent memory for this agent.

## Role
You are a helpful assistant with access to file, shell, and web tools.

## Memory
<!-- Add persistent notes here. This file is injected as your system prompt. -->
"""

_USER_TEMPLATE = """\
# USER.md

User profile and preferences.

## Preferences
<!-- Add user-specific preferences here. -->
"""


def bootstrap(workspace: Path) -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    agents_md = workspace / "AGENTS.md"
    user_md = workspace / "USER.md"
    if not agents_md.exists():
        agents_md.write_text(_AGENTS_TEMPLATE)
    if not user_md.exists():
        user_md.write_text(_USER_TEMPLATE)


def build_system_prompt(workspace: Path, extra: str = "") -> str:
    parts = []
    for name in ("AGENTS.md", "USER.md"):
        path = workspace / name
        if path.exists():
            parts.append(path.read_text())
    if extra:
        parts.append(extra)
    return "\n\n---\n\n".join(parts)
