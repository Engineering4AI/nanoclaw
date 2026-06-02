import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import type { Message } from "../providers/base.ts";

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
  // tracks how many messages per session have already been flushed to DB
  private readonly flushedCount = new Map<string, number>();

  constructor(
    dbPath: string,
    private readonly scope: string = "per-peer",
    private readonly idleHours: number = 8,
    private readonly resetHour: number = 4,
  ) {
    mkdirSync(resolve(dbPath, ".."), { recursive: true });
    this.db = new Database(dbPath);
    this._migrate();
  }

  private _migrate(): void {
    // Check if old schema exists (sessions.messages column)
    const hasOldCol = this.db
      .query<{ name: string; [k: string]: unknown }, []>("PRAGMA table_info(sessions)")
      .all()
      .some((r) => r.name === "messages");

    if (hasOldCol) {
      // Migrate existing rows into the new messages table, then drop the column.
      // SQLite doesn't support DROP COLUMN before 3.35, so we recreate the table.
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions_new (
          id          TEXT PRIMARY KEY,
          peer_id     TEXT NOT NULL,
          channel     TEXT NOT NULL,
          last_active TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
          session_id TEXT NOT NULL,
          seq        INTEGER NOT NULL,
          role       TEXT NOT NULL,
          content    TEXT NOT NULL,
          PRIMARY KEY (session_id, seq),
          FOREIGN KEY (session_id) REFERENCES sessions_new(id)
        );
        CREATE INDEX IF NOT EXISTS idx_peer_channel ON sessions_new(peer_id, channel);
      `);

      // Copy old sessions, migrating their message blobs into the messages table
      const oldRows = this.db
        .query<
          { id: string; peer_id: string; channel: string; messages: string; last_active: string },
          []
        >("SELECT * FROM sessions")
        .all();

      for (const row of oldRows) {
        this.db
          .query("INSERT OR IGNORE INTO sessions_new(id, peer_id, channel, last_active) VALUES(?,?,?,?)")
          .run(row.id, row.peer_id, row.channel, row.last_active);

        const msgs = JSON.parse(row.messages) as Message[];
        for (let i = 0; i < msgs.length; i++) {
          const msg = msgs[i]!;
          this.db
            .query("INSERT OR IGNORE INTO messages(session_id, seq, role, content) VALUES(?,?,?,?)")
            .run(row.id, i, msg.role, JSON.stringify(msg.content));
        }
      }

      this.db.exec(`
        DROP TABLE sessions;
        ALTER TABLE sessions_new RENAME TO sessions;
      `);
    } else {
      // Fresh install — create tables directly
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id          TEXT PRIMARY KEY,
          peer_id     TEXT NOT NULL,
          channel     TEXT NOT NULL,
          last_active TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_peer_channel ON sessions(peer_id, channel);
        CREATE TABLE IF NOT EXISTS messages (
          session_id TEXT NOT NULL,
          seq        INTEGER NOT NULL,
          role       TEXT NOT NULL,
          content    TEXT NOT NULL,
          PRIMARY KEY (session_id, seq),
          FOREIGN KEY (session_id) REFERENCES sessions(id)
        );
      `);
    }
  }

  private key(peerId: string, channel: string): string {
    return this.scope === "per-peer" ? peerId : `${channel}:${peerId}`;
  }

  private isExpired(session: Session): boolean {
    const now = new Date();
    const idleMs = this.idleHours * 60 * 60 * 1000;
    if (now.getTime() - session.lastActive.getTime() > idleMs) return true;

    const resetToday = new Date(now);
    resetToday.setHours(this.resetHour, 0, 0, 0);
    if (session.lastActive < resetToday && resetToday <= now) return true;

    return false;
  }

  private loadFromDb(peerId: string, channel: string): Session | null {
    const row = this.db
      .query<{ id: string; peer_id: string; channel: string; last_active: string }, [string, string]>(
        "SELECT * FROM sessions WHERE peer_id=? AND channel=?",
      )
      .get(peerId, channel);

    if (!row) return null;

    const msgRows = this.db
      .query<{ role: string; content: string }, [string]>(
        "SELECT role, content FROM messages WHERE session_id=? ORDER BY seq",
      )
      .all(row.id);

    const messages = msgRows.map((m) => ({
      role: m.role as Message["role"],
      content: JSON.parse(m.content) as Message["content"],
    }));

    const session: Session = {
      id: row.id,
      peerId: row.peer_id,
      channel: row.channel,
      messages,
      lastActive: new Date(row.last_active),
    };

    if (this.isExpired(session)) return null;

    // seed flushedCount so save() knows these rows are already in DB
    this.flushedCount.set(session.id, messages.length);
    return session;
  }

  getOrCreate(peerId: string, channel: string): Session {
    const key = this.key(peerId, channel);
    let session = this.cache.get(key);

    if (session && this.isExpired(session)) {
      console.log(`Session expired for ${key}, resetting`);
      this.flushedCount.delete(session.id);
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
    const already = this.flushedCount.get(session.id) ?? 0;
    const newMessages = session.messages.slice(already);
    const sessionId = session.id;
    const peerId = session.peerId;
    const channel = session.channel;
    const lastActive = session.lastActive.toISOString();
    const nextCount = session.messages.length;

    // update in-memory count immediately so concurrent calls don't double-insert
    this.flushedCount.set(sessionId, nextCount);

    // fire-and-forget — don't block the message handler
    queueMicrotask(() => {
      this.db
        .query("INSERT OR REPLACE INTO sessions(id, peer_id, channel, last_active) VALUES(?,?,?,?)")
        .run(sessionId, peerId, channel, lastActive);

      for (let i = 0; i < newMessages.length; i++) {
        const msg = newMessages[i]!;
        this.db
          .query("INSERT OR IGNORE INTO messages(session_id, seq, role, content) VALUES(?,?,?,?)")
          .run(sessionId, already + i, msg.role, JSON.stringify(msg.content));
      }
    });
  }
}
