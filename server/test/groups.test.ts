import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../src/db.ts';

const columns = (db: DatabaseSync, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => c.name);

test('a fresh database has groups and notes.group_id', () => {
  const db = openDb(':memory:');
  assert.ok(columns(db, 'notes').includes('group_id'));
  assert.ok(columns(db, 'groups').includes('sort_order'));
});

test('migration is idempotent — a second open does not throw', () => {
  const file = `/tmp/notebook-migration-${Date.now()}.db`;
  openDb(file).close();
  const second = openDb(file); // must not throw "duplicate column name: group_id"
  assert.ok(columns(second, 'notes').includes('group_id'));
  second.close();
});

test('migration preserves existing rows', () => {
  const file = `/tmp/notebook-preserve-${Date.now()}.db`;

  // A pre-groups database, written by hand exactly as the old schema had it.
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE notes (
      id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL, body TEXT NOT NULL, color TEXT,
      pinned INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, deleted_at INTEGER, PRIMARY KEY (id, user_id)
    );
    INSERT INTO users VALUES ('u1', 'a@example.com', 'hash', 1);
    INSERT INTO notes VALUES ('n1', 'u1', 'قدیمی', 'متن', null, 0, 1, 1, null);
  `);
  old.close();

  const db = openDb(file);
  const row = db.prepare('SELECT title, group_id FROM notes WHERE id = ?').get('n1') as {
    title: string;
    group_id: string | null;
  };
  assert.equal(row.title, 'قدیمی', 'migration lost an existing row');
  assert.equal(row.group_id, null, 'the new column should default to NULL');
  db.close();
});

import { buildApp } from '../src/index.ts';

const group = (over: Record<string, unknown> = {}) => ({
  id: 'g1',
  name: 'کار',
  color: null,
  order: 1,
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
  ...over,
});

const noteIn = (over: Record<string, unknown> = {}) => ({
  id: 'n1', title: 'سلام', body: 'متن', color: null, pinned: false,
  createdAt: 1000, updatedAt: 1000, deletedAt: null, groupId: null, ...over,
});

async function freshApp() {
  const app = await buildApp({
    db: openDb(':memory:'), jwtSecret: 'x'.repeat(32), origin: 'http://localhost:5173',
  });
  const signUp = async (email: string) => {
    const res = await app.inject({
      method: 'POST', url: '/auth/register',
      payload: { email, password: 'correct horse battery' },
    });
    assert.equal(res.statusCode, 200, res.body);
    return { authorization: `Bearer ${res.json().token}` };
  };
  // Typed rather than `unknown`: an `unknown` payload makes inject's overload
  // resolution fall back to the chainable union and every `.statusCode` fails to compile.
  const push = (headers: Record<string, string>, payload: { notes: object[]; groups?: object[] }) =>
    app.inject({ method: 'POST', url: '/sync/push', headers, payload });
  const pull = (headers: Record<string, string>, since = 0) =>
    app.inject({ method: 'GET', url: `/sync/pull?since=${since}`, headers });
  return { app, signUp, push, pull };
}

test('a note carrying groupId is accepted, not rejected as an unknown property', async () => {
  const { signUp, push, pull } = await freshApp();
  const a = await signUp('a@example.com');
  const res = await push(a, { notes: [noteIn({ groupId: 'g1' })] });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().rejected, []);
  assert.equal((await pull(a)).json().notes[0].groupId, 'g1');
});

test('groups round-trip', async () => {
  const { signUp, push, pull } = await freshApp();
  const a = await signUp('a@example.com');
  const created = await push(a, { notes: [], groups: [group()] });
  assert.equal(created.statusCode, 200);
  const groups = (await pull(a)).json().groups;
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, 'کار');
  assert.equal(groups[0].order, 1);
});

test('an older group push is rejected', async () => {
  const { signUp, push } = await freshApp();
  const a = await signUp('a@example.com');
  await push(a, { notes: [], groups: [group({ name: 'جدید', updatedAt: 2000 })] });
  const stale = await push(a, { notes: [], groups: [group({ name: 'قدیمی', updatedAt: 1000 })] });
  assert.deepEqual((stale.json() as { rejectedGroups: string[] }).rejectedGroups, ['g1']);
});

test('a group tombstone survives the round trip', async () => {
  const { signUp, push, pull } = await freshApp();
  const a = await signUp('a@example.com');
  await push(a, { notes: [], groups: [group()] });
  await push(a, { notes: [], groups: [group({ deletedAt: 2000, updatedAt: 2000 })] });
  assert.equal((await pull(a)).json().groups[0].deletedAt, 2000);
});

test('groups are per user — B cannot read or overwrite A', async () => {
  const { signUp, push, pull } = await freshApp();
  const a = await signUp('a@example.com');
  const b = await signUp('b@example.com');

  await push(a, { notes: [], groups: [group({ name: 'مالِ الف' })] });
  assert.equal((await pull(b)).json().groups.length, 0, "B read A's groups");

  await push(b, { notes: [], groups: [group({ name: 'مالِ ب', updatedAt: 9000 })] });
  assert.equal((await pull(a)).json().groups[0].name, 'مالِ الف', "B overwrote A's group");
});

test('a pull with no groups yet returns an empty array, not undefined', async () => {
  const { signUp, pull } = await freshApp();
  const a = await signUp('a@example.com');
  assert.deepEqual((await pull(a)).json().groups, []);
});

test('push without a groups key still works — an older client must not break', async () => {
  const { signUp, push } = await freshApp();
  const a = await signUp('a@example.com');
  const res = await push(a, { notes: [noteIn()] });
  assert.equal(res.statusCode, 200);
});
