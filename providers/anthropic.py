from __future__ import annotations

import asyncio
import logging

import anthropic

from ..config import Config
from .base import Provider, StreamResponse, ToolUse

log = logging.getLogger(__name__)

_RETRY_STATUS = {429, 529}
_MAX_RETRIES = 6


class AnthropicProvider(Provider):
    def __init__(self, config: Config):
        self._model = config.model
        self._client = anthropic.AsyncAnthropic(api_key=config.api_key or None)

    async def stream(self, messages: list[dict], tools: list[dict], model: str) -> StreamResponse:
        delay = 1.0
        for attempt in range(_MAX_RETRIES):
            try:
                return await self._call(messages, tools, model)
            except anthropic.RateLimitError:
                if attempt == _MAX_RETRIES - 1:
                    raise
                log.warning("Rate limited, retrying in %.1fs", delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, 60)
            except anthropic.APIStatusError as e:
                if e.status_code in _RETRY_STATUS and attempt < _MAX_RETRIES - 1:
                    await asyncio.sleep(delay)
                    delay = min(delay * 2, 60)
                else:
                    raise
        raise RuntimeError("unreachable")

    async def _call(self, messages: list[dict], tools: list[dict], model: str) -> StreamResponse:
        kwargs: dict = dict(
            model=model,
            max_tokens=8192,
            messages=messages,
        )
        if tools:
            kwargs["tools"] = tools

        # extract system message if present
        if messages and messages[0]["role"] == "system":
            kwargs["system"] = messages[0]["content"]
            kwargs["messages"] = messages[1:]

        async with self._client.messages.stream(**kwargs) as s:
            msg = await s.get_final_message()

        text = ""
        tool_uses: list[ToolUse] = []
        for block in msg.content:
            if block.type == "text":
                text = block.text
            elif block.type == "tool_use":
                tool_uses.append(ToolUse(id=block.id, name=block.name, input=block.input))

        return StreamResponse(
            text=text,
            stop_reason=msg.stop_reason or "end_turn",
            tool_uses=tool_uses,
            input_tokens=msg.usage.input_tokens,
            output_tokens=msg.usage.output_tokens,
        )
