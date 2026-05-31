from __future__ import annotations

import logging

log = logging.getLogger(__name__)

# Rough token estimate: 1 token ≈ 4 chars
_CHARS_PER_TOKEN = 4
_COMPACT_THRESHOLD = 0.80  # compact when estimated usage > 80% of context


def _estimate_tokens(messages: list[dict]) -> int:
    total = 0
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            total += len(content) // _CHARS_PER_TOKEN
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    total += len(str(block)) // _CHARS_PER_TOKEN
    return total


def needs_compaction(messages: list[dict], context_window: int) -> bool:
    return _estimate_tokens(messages) > context_window * _COMPACT_THRESHOLD


async def compact(messages: list[dict], provider, model: str) -> list[dict]:
    """Summarize turns[1..-5], keep system + last 4 turns intact."""
    if len(messages) < 6:
        return messages

    system = messages[0] if messages[0].get("role") == "system" else None
    body = messages[1:] if system else messages
    keep_tail = body[-4:]
    to_summarize = body[:-4]

    if not to_summarize:
        return messages

    log.info("Compacting %d messages into summary", len(to_summarize))

    summary_prompt = [
        {"role": "user", "content": (
            "Summarize the following conversation into a single paragraph that captures "
            "all key facts, decisions, and context needed to continue the task:\n\n"
            + "\n".join(
                f"[{m['role']}]: {m['content'] if isinstance(m['content'], str) else str(m['content'])}"
                for m in to_summarize
            )
        )}
    ]

    from ..providers.base import StreamResponse
    resp = await provider.stream(summary_prompt, [], model)
    summary_msg = {"role": "user", "content": f"[SUMMARY OF EARLIER CONVERSATION]\n{resp.text}"}

    result = []
    if system:
        result.append(system)
    result.append(summary_msg)
    result.extend(keep_tail)
    return result
