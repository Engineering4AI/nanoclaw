"""python -m nanoclaw — start the gateway."""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path


def _load_dotenv() -> None:
    env_file = Path(".env")
    if not env_file.exists():
        env_file = Path.home() / ".nanoclaw" / ".env"
    if not env_file.exists():
        return
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            # strip inline comments (outside quotes)
            if not (val.startswith('"') or val.startswith("'")):
                val = val.partition(" #")[0].partition("\t#")[0].strip()
            os.environ.setdefault(key, val)


_load_dotenv()

from .config import Config
from .gateway import start

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


def _build_adapters(config: Config) -> list:
    adapters = []
    if os.environ.get("TELEGRAM_TOKEN"):
        from .gateway.adapters.telegram import TelegramAdapter
        adapters.append(TelegramAdapter(os.environ["TELEGRAM_TOKEN"]))
    if os.environ.get("SLACK_BOT_TOKEN") and os.environ.get("SLACK_APP_TOKEN"):
        from .gateway.adapters.slack import SlackAdapter
        adapters.append(SlackAdapter(os.environ["SLACK_BOT_TOKEN"], os.environ["SLACK_APP_TOKEN"]))
    if os.environ.get("DISCORD_TOKEN"):
        from .gateway.adapters.discord import DiscordAdapter
        adapters.append(DiscordAdapter(os.environ["DISCORD_TOKEN"]))
    return adapters


def main() -> None:
    config = Config.load()
    adapters = _build_adapters(config)
    if not config.api_key:
        print("No LLM key found. Set OPENROUTER_API_KEY (default), ANTHROPIC_API_KEY, or OPENAI_API_KEY.")
        sys.exit(1)
    if not adapters:
        print("No adapters configured. Set TELEGRAM_TOKEN, SLACK_BOT_TOKEN/SLACK_APP_TOKEN, or DISCORD_TOKEN.")
        sys.exit(1)
    asyncio.run(start(config, adapters))


if __name__ == "__main__":
    main()
