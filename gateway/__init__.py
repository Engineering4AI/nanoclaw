from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..config import Config

log = logging.getLogger(__name__)


@dataclass
class GatewayConfig:
    reset_hour: int = 4          # daily session reset at 04:00 local
    idle_hours: int = 8          # also reset after N hours idle
    session_scope: str = "per-peer"  # "per-peer" | "per-channel-peer"
    max_chunk_chars: int = 1000  # for block streaming


async def start(config: "Config", adapters: list) -> None:
    from .router import Router
    router = Router(config)
    await asyncio.gather(*[adapter.start(router.on_message) for adapter in adapters])
