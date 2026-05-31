from __future__ import annotations

import logging
from typing import Callable

from .base import ChannelAdapter

log = logging.getLogger(__name__)


class DiscordAdapter(ChannelAdapter):
    """Discord adapter using discord.py."""

    def __init__(self, token: str):
        self._token = token
        self._client = None

    async def start(self, on_message: Callable) -> None:
        import discord

        intents = discord.Intents.default()
        intents.message_content = True
        client = discord.Client(intents=intents)
        self._client = client
        _router_on_message = on_message

        @client.event
        async def on_message(message):
            if message.author == client.user:
                return
            peer_id = str(message.author.id)

            async def deliver(pid: str, text: str) -> None:
                await message.channel.send(text)

            await _router_on_message("discord", peer_id, message.content, deliver)

        log.info("Discord adapter starting")
        await client.start(self._token)

    async def send(self, peer_id: str, text: str) -> None:
        pass  # Discord requires a channel reference; use deliver() in on_message instead
