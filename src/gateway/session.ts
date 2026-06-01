import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import type { Message } from "../providers/base.ts";

const DDL = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    peer_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    messages TEXT NOT NULL DEFAULT '[]',
    last_active TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_peer_channel ON sessions(peer_id, channel);
`;

export interface Session {
  id: string;
  peerId: string;
  channel: string;
  messages: Message[];
  lastActive: Date;
}

export class SessionStore {
  private readonly db: Database;
  private readonly cache = new Map<string, Session>();

  constructor(
    dbPath: string,
    private readonly scope: string = "per-peer",
    private readonly idleHours: number = 8,
    private readonly resetHour: number = 4,
  ) {
    mkdirSync(resolve(dbPath, ".."), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(DDL);
  }

  private key(peerId: string, channel: string): string {
    return this.scope === "per-peer" ? peerId : `${channel}:${peerId}`;
  }

  private isExpired(session: Session): boolean {
    const now = new Date();
    const idleMs = this.idleHours * 60 * 60 * 1000;
    if (now.getTime() - session.lastActive.getTime() > idleMs) return true;

    // daily reset at configured hour
    const resetToday = new Date(now);
    resetToday.setHours(this.resetHour, 0, 0, 0);
    if (session.lastActive < resetToday && resetToday <= now) return true;

    return false;
  }

  private loadFromDb(peerId: string, channel: string): Session | null {
    const row = this.db
      .query<
        { id: string; peer_id: string; channel: string; messages: string; last_active: string },
        [string, string]
      >(
        "SELECT * FROM sessions WHERE peer_id=? AND channel=?",
      )
      .get(peerId, channel);

    if (!row) return null;

    const session: Session = {
      id: row.id,
      peerId: row.peer_id,
      channel: row.channel,
      messages: JSON.parse(row.messages) as Message[],
      lastActive: new Date(row.last_active),
    };

    return this.isExpired(session) ? null : session;
  }

  getOrCreate(peerId: string, channel: string): Session {
    const key = this.key(peerId, channel);
    let session = this.cache.get(key);

    if (session && this.isExpired(session)) {
      console.log(`Session expired for ${key}, resetting`);
      session = undefined;
      this.cache.delete(key);
    }

    if (!session) {
      session = this.loadFromDb(peerId, channel) ?? {
        id: randomUUID(),
        peerId,
        channel,
        messages: [],
        lastActive: new Date(),
      };
      this.cache.set(key, session);
    }

    return session;
  }

  save(session: Session): void {
    session.lastActive = new Date();
    this.db
      .query(
        "INSERT OR REPLACE INTO sessions(id, peer_id, channel, messages, last_active) VALUES(?,?,?,?,?)",
      )
      .run(
        session.id,
        session.peerId,
        session.channel,
        JSON.stringify(session.messages),
        session.lastActive.toISOString(),
      );
  }
}
