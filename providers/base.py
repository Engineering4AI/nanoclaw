from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolUse:
    id: str
    name: str
    input: dict


@dataclass
class StreamResponse:
    text: str
    stop_reason: str          # "end_turn" | "tool_use" | "max_tokens"
    tool_uses: list[ToolUse] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0

    def as_assistant_message(self) -> dict:
        content: list[Any] = []
        if self.text:
            content.append({"type": "text", "text": self.text})
        for tu in self.tool_uses:
            content.append({
                "type": "tool_use",
                "id": tu.id,
                "name": tu.name,
                "input": tu.input,
            })
        return {"role": "assistant", "content": content}


@dataclass
class ToolResult:
    tool_use_id: str
    content: str
    is_error: bool = False


def tool_results_as_message(results: list[ToolResult]) -> dict:
    return {
        "role": "user",
        "content": [
            {
                "type": "tool_result",
                "tool_use_id": r.tool_use_id,
                "content": r.content,
                "is_error": r.is_error,
            }
            for r in results
        ],
    }


class Provider(ABC):
    @abstractmethod
    async def stream(self, messages: list[dict], tools: list[dict], model: str) -> StreamResponse:
        ...
