from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml

DEFAULT_CONFIG_PATH = Path.home() / ".nanoclaw" / "config.yaml"
DEFAULT_WORKSPACE = Path.home() / ".nanoclaw" / "workspace"
DEFAULT_SESSIONS = Path.home() / ".nanoclaw" / "sessions"


@dataclass
class Config:
    model: str = "anthropic/claude-sonnet-4-5"
    provider: str = "openai_compatible"  # anthropic | openai | openai_compatible
    api_key: str = ""
    base_url: str = "https://openrouter.ai/api/v1"
    max_tokens: int = 8192
    max_iterations: int = 40
    workspace: Path = field(default_factory=lambda: DEFAULT_WORKSPACE)
    sessions_dir: Path = field(default_factory=lambda: DEFAULT_SESSIONS)
    permission_mode: str = "default"     # default | auto | plan
    web_proxy: str = ""

    @classmethod
    def load(cls, path: Path = DEFAULT_CONFIG_PATH) -> "Config":
        cfg = cls()
        if path.exists():
            with open(path) as f:
                data = yaml.safe_load(f) or {}
            for k, v in data.items():
                if hasattr(cfg, k):
                    if k in ("workspace", "sessions_dir"):
                        setattr(cfg, k, Path(v).expanduser())
                    else:
                        setattr(cfg, k, v)
        # env overrides
        cfg.api_key = os.environ.get("OPENROUTER_API_KEY", os.environ.get("ANTHROPIC_API_KEY", os.environ.get("OPENAI_API_KEY", cfg.api_key)))
        if os.environ.get("NANOCLAW_MODEL"):
            cfg.model = os.environ["NANOCLAW_MODEL"]
        if os.environ.get("NANOCLAW_PROVIDER"):
            cfg.provider = os.environ["NANOCLAW_PROVIDER"]
        if os.environ.get("NANOCLAW_BASE_URL"):
            cfg.base_url = os.environ["NANOCLAW_BASE_URL"]
        if os.environ.get("NANOCLAW_MAX_TOKENS"):
            cfg.max_tokens = int(os.environ["NANOCLAW_MAX_TOKENS"])
        if os.environ.get("NANOCLAW_MAX_ITERATIONS"):
            cfg.max_iterations = int(os.environ["NANOCLAW_MAX_ITERATIONS"])
        if os.environ.get("NANOCLAW_PERMISSION_MODE"):
            cfg.permission_mode = os.environ["NANOCLAW_PERMISSION_MODE"]
        if os.environ.get("NANOCLAW_WEB_PROXY"):
            cfg.web_proxy = os.environ["NANOCLAW_WEB_PROXY"]
        if os.environ.get("NANOCLAW_WORKSPACE"):
            cfg.workspace = Path(os.environ["NANOCLAW_WORKSPACE"]).expanduser()
        return cfg

    def save(self, path: Path = DEFAULT_CONFIG_PATH) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            yaml.dump({
                "model": self.model,
                "provider": self.provider,
                "api_key": self.api_key,
                "base_url": self.base_url,
                "max_tokens": self.max_tokens,
                "max_iterations": self.max_iterations,
                "workspace": str(self.workspace),
                "sessions_dir": str(self.sessions_dir),
                "permission_mode": self.permission_mode,
                "web_proxy": self.web_proxy,
            }, f, default_flow_style=False)
