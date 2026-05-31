from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Callable

from .. import hooks
from ..permissions import PermissionPolicy
from ..providers.base import ToolResult

log = logging.getLogger(__name__)

_LARGE_OUTPUT_THRESHOLD = 50_000  # bytes


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict
    execute: Callable

    def as_api_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
        }

    async def run(self, tool_use_id: str, args: dict, policy: PermissionPolicy) -> ToolResult:
        try:
            policy.check(self.name, args)
        except Exception as e:
            return ToolResult(tool_use_id=tool_use_id, content=str(e), is_error=True)

        try:
            await hooks.pre(self.name, args)
            result = await self.execute(args)
            await hooks.post(self.name, args, result)
        except Exception as e:
            log.exception("Tool %s failed", self.name)
            return ToolResult(tool_use_id=tool_use_id, content=f"Error: {e}", is_error=True)

        if len(result.encode()) > _LARGE_OUTPUT_THRESHOLD:
            result = result[:_LARGE_OUTPUT_THRESHOLD] + f"\n[... truncated at {_LARGE_OUTPUT_THRESHOLD} bytes]"

        return ToolResult(tool_use_id=tool_use_id, content=result)


async def execute_parallel(tool_uses: list, registry: dict[str, Tool], policy: PermissionPolicy) -> list[ToolResult]:
    tasks = [
        registry[tu.name].run(tu.id, tu.input, policy)
        if tu.name in registry
        else asyncio.coroutine(lambda tu=tu: ToolResult(tu.id, f"Unknown tool: {tu.name}", True))()
        for tu in tool_uses
    ]
    return list(await asyncio.gather(*tasks))


def build_registry(*tool_lists: list[Tool]) -> dict[str, Tool]:
    registry: dict[str, Tool] = {}
    for tools in tool_lists:
        for t in tools:
            registry[t.name] = t
    return registry
