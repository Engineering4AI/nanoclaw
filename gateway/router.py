from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path

from ..config import Config
from ..memory.workspace import bootstrap, build_system_prompt
from ..permissions import PermissionPolicy, PermissionRequired
from ..agent import loop as agent_loop
from .session import SessionStore

log = logging.getLogger(__name__)

_MAX_CHUNK = 1000  # chars per block when streaming long responses


def _chunk_response(text: str, max_chars: int = _MAX_CHUNK) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    paragraphs = re.split(r"\n{2,}", text)
    chunks: list[str] = []
    current = ""
    for para in paragraphs:
        candidate = (current + "\n\n" + para).strip() if current else para
        if len(candidate) > max_chars and current:
            chunks.append(current)
            current = para
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


class Router:
    def __init__(self, config: Config):
        self._config = config
        db_path = Path.home() / ".nanoclaw" / "gateway.db"
        self._store = SessionStore(db_path)
        self._active: dict[str, asyncio.Lock] = {}
        bootstrap(config.workspace)

    async def on_message(self, channel: str, peer_id: str, text: str, deliver) -> None:
        key = f"{channel}:{peer_id}"
        if key not in self._active:
            self._active[key] = asyncio.Lock()
        lock = self._active[key]

        if lock.locked():
            log.info("Dropping message from %s — turn already in progress", key)
            return

        async with lock:
            session = self._store.get_or_create(peer_id, channel)
            system_prompt = build_system_prompt(self._config.workspace)

            if not session.messages:
                session.messages.append({"role": "system", "content": system_prompt})

            session.messages.append({"role": "user", "content": text})

            policy = PermissionPolicy.from_mode(self._config.permission_mode)

            try:
                response = await agent_loop.run(
                    session.messages,
                    self._config,
                    session_id=session.id,
                    policy=policy,
                )
            except PermissionRequired as e:
                response = f"[Permission required for {e.tool} — switch to auto mode or approve explicitly]"
            except Exception as e:
                log.exception("Agent error for %s", key)
                response = f"[Error: {e}]"

            session.messages.append({"role": "assistant", "content": response})
            self._store.save(session)

            for chunk in _chunk_response(response):
                await deliver(peer_id, chunk)
