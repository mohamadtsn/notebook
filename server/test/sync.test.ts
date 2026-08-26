import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/index.ts';
import { openDb } from '../src/db.ts';

const note = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  title: 'سلام',
  body: 'متن',
  color: null,
  pinned: false,
  createdAt: 1000,
  updatedAt: 1000,
  deletedAt: null,
  ...over,
});

async function fresh() {
  const app = await buildApp({
    db: openDb(':memory:'),
    jwtSecret: 'x'.repeat(32),
    origin: 'http://localhost:5173',
  });

  const signUp = async (email: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'correct horse battery' },
    });
    assert.equal(res.statusCode, 200, res.body);
    return { authorization: `Bearer ${res.json().token}` };
  };

  const push = (headers: Record<string, string>, notes: unknown[]) =>
    app.inject({ method: 'POST', url: '/sync/push', headers, payload: { notes } });

  const pull = (headers: Record<string, string>, since = 0) =>
    app.inject({ method: 'GET', url: `/sync/pull?since=${since}`, headers });

  return { app, signUp, push, pull };
}

test('push then pull round-trips a note', async () => {
  const { signUp, push, pull } = await fresh();
  const a = await signUp('a@example.com');

  const pushed = await push(a, [note()]);
  assert.equal(pushed.statusCode, 200);
  assert.deepEqual(pushed.json().rejected, []);

  const notes = (await pull(a)).json().notes;
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, 'سلام');
  assert.equal(notes[0].pinned, false);
  assert.equal(notes[0].deletedAt, null);
});

test('newer push wins, older push is rejected', async () => {
  const { signUp, push, pull } = await fresh();
  const a = await signUp('a@example.com');

  await push(a, [note()]);
  await push(a, [note({ title: 'newer', updatedAt: 2000 })]);
  assert.equal((await pull(a)).json().notes[0].title, 'newer');

  const stale = await push(a, [note({ title: 'older', updatedAt: 1500 })]);
  assert.deepEqual(stale.json().rejected, ['n1']);
  assert.equal((await pull(a)).json().notes[0].title, 'newer');
});

test('pull since cursor only returns what changed after it', async () => {
  const { signUp, push, pull } = await fresh();
  const a = await signUp('a@example.com');

  await push(a, [note(), note({ id: 'n2', updatedAt: 3000 })]);
  const changed = (await pull(a, 2000)).json().notes;
  assert.deepEqual(changed.map((n: { id: string }) => n.id), ['n2']);
});

test('a delete propagates as a tombstone, not a missing row', async () => {
  const { signUp, push, pull } = await fresh();
  const a = await signUp('a@example.com');

  await push(a, [note()]);
  await push(a, [note({ updatedAt: 2000, deletedAt: 2000 })]);

  const notes = (await pull(a)).json().notes;
  assert.equal(notes.length, 1);
  assert.equal(notes[0].deletedAt, 2000);
});

test('users cannot read or overwrite each other notes', async () => {
  const { signUp, push, pull } = await fresh();
  const a = await signUp('a@example.com');
  const b = await signUp('b@example.com');

  await push(a, [note({ title: 'private to a' })]);

  assert.deepEqual((await pull(b)).json().notes, []);

  // Same note id, newer timestamp, different user: must not touch A's row.
  await push(b, [note({ title: 'b overwrite attempt', updatedAt: 9000 })]);
  assert.equal((await pull(a)).json().notes[0].title, 'private to a');
  assert.equal((await pull(b)).json().notes[0].title, 'b overwrite attempt');
});

test('sync rejects requests without a valid token', async () => {
  const { app } = await fresh();
  const res = await app.inject({ method: 'GET', url: '/sync/pull' });
  assert.equal(res.statusCode, 401);
});

test('login fails on a wrong password and succeeds on the right one', async () => {
  const { app, signUp } = await fresh();
  await signUp('a@example.com');

  const bad = await app.inject({
    method: 'POST', url: '/auth/login',
    payload: { email: 'a@example.com', password: 'wrong password here' },
  });
  assert.equal(bad.statusCode, 401);

  const good = await app.inject({
    method: 'POST', url: '/auth/login',
    // Different case, same account: emails are normalized before lookup.
    payload: { email: 'A@Example.com', password: 'correct horse battery' },
  });
  assert.equal(good.statusCode, 200);
  assert.ok(good.json().token);
});
test('the direction pin round-trips, and a note without one reads as auto', async () => {
  const { signUp, push, pull } = await fresh();
  const headers = await signUp('dir@example.com');

  const res = await push(headers, [
    note({ id: 'pinned', dir: 'ltr' }),
    // A client that predates v4 sends no `dir` at all. It must not be rejected, and it
    // must come back as 'auto' rather than null — the client puts this on a dir="".
    note({ id: 'legacy' }),
  ]);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().rejected, []);

  const notes = (await pull(headers)).json().notes as { id: string; dir: string }[];
  const byId = new Map(notes.map(n => [n.id, n]));
  assert.equal(byId.get('pinned')?.dir, 'ltr');
  assert.equal(byId.get('legacy')?.dir, 'auto');
});

test('an unknown direction is rejected at the route boundary', async () => {
  const { signUp, push } = await fresh();
  const headers = await signUp('baddir@example.com');

  const res = await push(headers, [note({ dir: 'sideways' })]);
  assert.equal(res.statusCode, 400, res.body);
});
