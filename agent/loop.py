from __future__ import annotations

import logging
from pathlib import Path

from ..config import Config
from ..permissions import PermissionPolicy
from ..providers import get_provider
from ..providers.base import tool_results_as_message
from ..tools import Tool, execute_parallel, build_registry
from ..tools.files import FILE_TOOLS
from ..tools.shell import SHELL_TOOLS
from ..tools.web import WEB_TOOLS
from . import compactor
from . import session as sess

log = logging.getLogger(__name__)

_CONTEXT_WINDOWS = {
    "claude-opus": 200_000,
    "claude-sonnet": 200_000,
    "claude-haiku": 200_000,
    "gpt-4": 128_000,
    "gpt-5.5-pro": 128_000,
    "default": 128_000,
}


def _context_window(model: str) -> int:
    for prefix, size in _CONTEXT_WINDOWS.items():
        if prefix in model:
            return size
    return _CONTEXT_WINDOWS["default"]


def default_tools() -> list[Tool]:
    return FILE_TOOLS + SHELL_TOOLS + WEB_TOOLS


async def run(
    messages: list[dict],
    config: Config,
    *,
    extra_tools: list[Tool] | None = None,
    session_id: str | None = None,
    policy: PermissionPolicy | None = None,
) -> str:
    provider = get_provider(config)
    tools = default_tools() + (extra_tools or [])
    registry = build_registry(tools)
    api_tools = [t.as_api_dict() for t in tools]
    policy = policy or PermissionPolicy.from_mode(config.permission_mode)
    ctx_window = _context_window(config.model)

    for iteration in range(config.max_iterations):
        # compact if approaching context limit
        if compactor.needs_compaction(messages, ctx_window):
            messages = await compactor.compact(messages, provider, config.model)

        response = await provider.stream(messages, api_tools, config.model)
        messages.append(response.as_assistant_message())

        if session_id:
            sess.append_turn(config.sessions_dir, session_id, [response.as_assistant_message()])

        log.debug(
            "iter=%d stop=%s tokens_in=%d tokens_out=%d",
            iteration, response.stop_reason, response.input_tokens, response.output_tokens,
        )

        if response.stop_reason != "tool_use":
            return response.text

        if response.input_tokens + response.output_tokens >= config.max_tokens:
            log.warning("Token limit reached at iteration %d", iteration)
            return response.text or "[max tokens reached]"

        results = await execute_parallel(response.tool_uses, registry, policy)
        tool_msg = tool_results_as_message(results)
        messages.append(tool_msg)

        if session_id:
            sess.append_turn(config.sessions_dir, session_id, [tool_msg])

    return "[max iterations reached]"
