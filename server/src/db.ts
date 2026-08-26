import { DatabaseSync } from 'node:sqlite';

/**
 * node:sqlite instead of better-sqlite3 — same synchronous API shape, ships with
 * Node 24, and removes a native build step from the alpine image entirely.
 */
export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,
      email      TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    -- One row per issued token, keyed by the token's jti claim. Without this the JWT
    -- is stateless and "sign this device out" cannot mean anything: the old token
    -- would keep working until it expired 30 days later.
    CREATE TABLE IF NOT EXISTS sessions (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL REFERENCES users(id),
      created_at   INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      user_agent   TEXT
    );

    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS notes (
      id         TEXT NOT NULL,
      user_id    TEXT NOT NULL REFERENCES users(id),
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      color      TEXT,
      pinned     INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      PRIMARY KEY (id, user_id)
    );

    CREATE INDEX IF NOT EXISTS notes_user_updated ON notes(user_id, updated_at);

    CREATE TABLE IF NOT EXISTS groups (
      id         TEXT NOT NULL,
      user_id    TEXT NOT NULL REFERENCES users(id),
      name       TEXT NOT NULL,
      color      TEXT,
      sort_order REAL NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      PRIMARY KEY (id, user_id)
    );

    CREATE INDEX IF NOT EXISTS groups_user_updated ON groups(user_id, updated_at);

    -- One row per user, so the primary key *is* the user id: there is no client-supplied
    -- id here and therefore no cross-user id to collide.
    -- Daily AI quota. Keyed on (user, day) so one account cannot spend another's
    -- budget, and so yesterday's rows are trivially prunable.
    CREATE TABLE IF NOT EXISTS ai_usage (
      user_id TEXT NOT NULL REFERENCES users(id),
      day     TEXT NOT NULL,
      count   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id    TEXT PRIMARY KEY REFERENCES users(id),
      json       TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  /**
   * SQLite has no `ADD COLUMN IF NOT EXISTS`, and the database file lives on a host
   * bind mount that is never recreated — so this has to be idempotent by inspection.
   * A second open on an already-migrated file must be a silent no-op, not a crash loop.
   *
   * No foreign key to groups(id): sync delivers rows in arbitrary order and a note can
   * legitimately arrive before its group. Referential integrity is resolved on read —
   * an unknown group_id renders as «بدون گروه».
   */
  const noteColumns = (db.prepare('PRAGMA table_info(notes)').all() as { name: string }[])
    .map(c => c.name);
  if (!noteColumns.includes('group_id')) {
    db.exec('ALTER TABLE notes ADD COLUMN group_id TEXT');
  }
  // Pinned body direction. NULL on every pre-v4 row and read back as 'auto'.
  if (!noteColumns.includes('dir')) {
    db.exec('ALTER TABLE notes ADD COLUMN dir TEXT');
  }

  return db;
}

export type Db = DatabaseSync;