from .base import Provider, StreamResponse
from .anthropic import AnthropicProvider
from .openai import OpenAIProvider
from ..config import Config


def get_provider(config: Config) -> Provider:
    if config.provider == "anthropic":
        return AnthropicProvider(config)
    elif config.provider in ("openai", "openai_compatible"):
        return OpenAIProvider(config)
    else:
        raise ValueError(f"Unknown provider: {config.provider}")
