from __future__ import annotations

import logging
from typing import Callable

from .base import ChannelAdapter

log = logging.getLogger(__name__)


class TelegramAdapter(ChannelAdapter):
    """Telegram adapter using python-telegram-bot (polling mode)."""

    def __init__(self, token: str):
        self._token = token
        self._app = None

    async def start(self, on_message: Callable) -> None:
        from telegram.ext import Application, MessageHandler, filters

        app = Application.builder().token(self._token).build()
        self._app = app

        async def handler(update, context):
            msg = update.message
            if not msg or not msg.text:
                return
            peer_id = str(msg.chat_id)

            async def deliver(pid: str, text: str) -> None:
                await context.bot.send_message(chat_id=int(pid), text=text)

            await on_message("telegram", peer_id, msg.text, deliver)

        app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handler))
        log.info("Telegram adapter starting (polling)")
        await app.initialize()
        await app.start()
        await app.updater.start_polling()
        # keep running until cancelled
        try:
            import asyncio
            await asyncio.Event().wait()
        finally:
            await app.updater.stop()
            await app.stop()
            await app.shutdown()

    async def send(self, peer_id: str, text: str) -> None:
        if self._app:
            await self._app.bot.send_message(chat_id=int(peer_id), text=text)
