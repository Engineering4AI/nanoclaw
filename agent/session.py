from __future__ import annotations

import json
import uuid
from pathlib import Path


def new_session_id() -> str:
    return str(uuid.uuid4())


def append_turn(sessions_dir: Path, session_id: str, messages: list[dict]) -> None:
    sessions_dir.mkdir(parents=True, exist_ok=True)
    path = sessions_dir / f"{session_id}.jsonl"
    with open(path, "a") as f:
        for msg in messages:
            f.write(json.dumps(msg, ensure_ascii=False) + "\n")


def load_session(sessions_dir: Path, session_id: str) -> list[dict]:
    path = sessions_dir / f"{session_id}.jsonl"
    if not path.exists():
        return []
    messages = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                messages.append(json.loads(line))
    return messages
