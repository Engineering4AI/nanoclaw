from __future__ import annotations

from typing import Any, Awaitable, Callable

PreHook = Callable[[str, dict], Awaitable[None]]
PostHook = Callable[[str, dict, str], Awaitable[None]]

_pre_hooks: list[PreHook] = []
_post_hooks: list[PostHook] = []


def register_pre(fn: PreHook) -> None:
    _pre_hooks.append(fn)


def register_post(fn: PostHook) -> None:
    _post_hooks.append(fn)


async def pre(tool_name: str, args: dict) -> None:
    for fn in _pre_hooks:
        await fn(tool_name, args)


async def post(tool_name: str, args: dict, result: str) -> None:
    for fn in _post_hooks:
        await fn(tool_name, args, result)
