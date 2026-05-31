from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

log = logging.getLogger(__name__)

_DDL = """
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    peer_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    messages TEXT NOT NULL DEFAULT '[]',
    last_active TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_peer_channel ON sessions(peer_id, channel);
"""


@dataclass
class Session:
    id: str
    peer_id: str
    channel: str
    messages: list = field(default_factory=list)
    last_active: datetime = field(default_factory=datetime.utcnow)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)


class SessionStore:
    def __init__(self, db_path: Path, scope: str = "per-peer", idle_hours: int = 8, reset_hour: int = 4):
        self._db_path = db_path
        self._scope = scope
        self._idle_hours = idle_hours
        self._reset_hour = reset_hour
        self._cache: dict[str, Session] = {}
        db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.executescript(_DDL)

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _key(self, peer_id: str, channel: str) -> str:
        if self._scope == "per-peer":
            return peer_id
        return f"{channel}:{peer_id}"

    def get_or_create(self, peer_id: str, channel: str) -> Session:
        key = self._key(peer_id, channel)
        session = self._cache.get(key)

        if session and self._is_expired(session):
            log.info("Session expired for %s, resetting", key)
            session = None
            del self._cache[key]

        if session is None:
            session = self._load(key, peer_id, channel) or Session(
                id=str(uuid.uuid4()),
                peer_id=peer_id,
                channel=channel,
            )
            self._cache[key] = session

        return session

    def _is_expired(self, session: Session) -> bool:
        now = datetime.utcnow()
        if now - session.last_active > timedelta(hours=self._idle_hours):
            return True
        # daily reset at configured hour
        reset_today = now.replace(hour=self._reset_hour, minute=0, second=0, microsecond=0)
        if session.last_active < reset_today <= now:
            return True
        return False

    def _load(self, key: str, peer_id: str, channel: str) -> Session | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM sessions WHERE peer_id=? AND channel=?",
                (peer_id if self._scope == "per-peer" else peer_id, channel)
            ).fetchone()
        if not row:
            return None
        s = Session(
            id=row["id"],
            peer_id=row["peer_id"],
            channel=row["channel"],
            messages=json.loads(row["messages"]),
            last_active=datetime.fromisoformat(row["last_active"]),
        )
        return s if not self._is_expired(s) else None

    def save(self, session: Session) -> None:
        session.last_active = datetime.utcnow()
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO sessions(id, peer_id, channel, messages, last_active) VALUES(?,?,?,?,?)",
                (session.id, session.peer_id, session.channel,
                 json.dumps(session.messages), session.last_active.isoformat()),
            )
