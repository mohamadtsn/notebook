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
  `);
  return db;
}

export type Db = DatabaseSync;