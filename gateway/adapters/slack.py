from __future__ import annotations

import logging
from typing import Callable

from .base import ChannelAdapter

log = logging.getLogger(__name__)


class SlackAdapter(ChannelAdapter):
    """Slack adapter using slack_bolt (socket mode)."""

    def __init__(self, bot_token: str, app_token: str):
        self._bot_token = bot_token
        self._app_token = app_token
        self._client = None

    async def start(self, on_message: Callable) -> None:
        from slack_bolt.async_app import AsyncApp
        from slack_bolt.adapter.socket_mode.async_handler import AsyncSocketModeHandler

        app = AsyncApp(token=self._bot_token)
        self._client = app.client

        @app.event("message")
        async def handle(event, say):
            if event.get("bot_id"):
                return
            peer_id = event.get("user")
            if not peer_id:
                return
            text = event.get("text", "")

            async def deliver(pid: str, response: str) -> None:
                await say(text=response, channel=event["channel"])

            await on_message("slack", peer_id, text, deliver)

        handler = AsyncSocketModeHandler(app, self._app_token)
        log.info("Slack adapter starting (socket mode)")
        await handler.start_async()

    async def send(self, peer_id: str, text: str) -> None:
        if self._client:
            await self._client.chat_postMessage(channel=peer_id, text=text)
