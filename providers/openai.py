from __future__ import annotations

import asyncio
import json
import logging

import openai as oai

from ..config import Config
from .base import Provider, StreamResponse, ToolUse

log = logging.getLogger(__name__)

_MAX_RETRIES = 6


class OpenAIProvider(Provider):
    def __init__(self, config: Config):
        kwargs: dict = {"api_key": config.api_key or None}
        if config.base_url:
            kwargs["base_url"] = config.base_url
        self._client = oai.AsyncOpenAI(**kwargs)
        self._model = config.model

    async def stream(self, messages: list[dict], tools: list[dict], model: str) -> StreamResponse:
        delay = 1.0
        for attempt in range(_MAX_RETRIES):
            try:
                return await self._call(messages, tools, model)
            except oai.RateLimitError:
                if attempt == _MAX_RETRIES - 1:
                    raise
                await asyncio.sleep(delay)
                delay = min(delay * 2, 60)

    @staticmethod
    def _convert_messages(messages: list[dict]) -> list[dict]:
        """Convert Anthropic-style content blocks to OpenAI format."""
        out = []
        for msg in messages:
            role = msg["role"]
            content = msg.get("content", "")
            if isinstance(content, str):
                out.append({"role": role, "content": content})
                continue
            # Anthropic list content
            if role == "assistant":
                text_parts = [b["text"] for b in content if b.get("type") == "text"]
                tool_calls = [
                    {"id": b["id"], "type": "function", "function": {
                        "name": b["name"],
                        "arguments": json.dumps(b["input"]),
                    }}
                    for b in content if b.get("type") == "tool_use"
                ]
                entry: dict = {"role": "assistant", "content": " ".join(text_parts) or None}
                if tool_calls:
                    entry["tool_calls"] = tool_calls
                out.append(entry)
            elif role == "user":
                # may be tool_result blocks
                tool_results = [b for b in content if b.get("type") == "tool_result"]
                if tool_results:
                    for b in tool_results:
                        out.append({
                            "role": "tool",
                            "tool_call_id": b["tool_use_id"],
                            "content": b["content"] if isinstance(b["content"], str)
                                       else json.dumps(b["content"]),
                        })
                else:
                    text = " ".join(b.get("text", "") for b in content if b.get("type") == "text")
                    out.append({"role": "user", "content": text})
            else:
                out.append(msg)
        return out

    async def _call(self, messages: list[dict], tools: list[dict], model: str) -> StreamResponse:
        kwargs: dict = dict(model=model, messages=self._convert_messages(messages))
        if tools:
            # convert Anthropic tool schema to OpenAI function schema
            kwargs["tools"] = [
                {"type": "function", "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t.get("input_schema", {}),
                }}
                for t in tools
            ]
            kwargs["tool_choice"] = "auto"

        resp = await self._client.chat.completions.create(**kwargs)
        choice = resp.choices[0]
        msg = choice.message

        text = msg.content or ""
        tool_uses: list[ToolUse] = []
        if msg.tool_calls:
            for tc in msg.tool_calls:
                tool_uses.append(ToolUse(
                    id=tc.id,
                    name=tc.function.name,
                    input=json.loads(tc.function.arguments),
                ))

        stop = "tool_use" if tool_uses else "end_turn"
        if choice.finish_reason == "length":
            stop = "max_tokens"

        usage = resp.usage
        return StreamResponse(
            text=text,
            stop_reason=stop,
            tool_uses=tool_uses,
            input_tokens=usage.prompt_tokens if usage else 0,
            output_tokens=usage.completion_tokens if usage else 0,
        )
