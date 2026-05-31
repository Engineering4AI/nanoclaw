from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Callable


class ChannelAdapter(ABC):
    @abstractmethod
    async def start(self, on_message: Callable) -> None:
        """Register handler and start listening. on_message(channel, peer_id, text, deliver)."""
        ...

    @abstractmethod
    async def send(self, peer_id: str, text: str) -> None:
        """Deliver a response to the peer."""
        ...
