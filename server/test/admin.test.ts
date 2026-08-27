import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/index.ts';
import { openDb } from '../src/db.ts';

const PASSWORD = 'correct horse battery';

async function fresh() {
  process.env.PRO_EMAILS = '';
  process.env.ADMIN_EMAILS = 'boss@example.com';
  const db = openDb(':memory:');
  const app = await buildApp({
    db, jwtSecret: 'x'.repeat(32), origin: 'http://localhost:5173',
  });

  const register = async (email: string) => {
    const res = await app.inject({
      method: 'POST', url: '/auth/register', payload: { email, password: PASSWORD },
    });
    assert.equal(res.statusCode, 200, res.body);
    return { authorization: `Bearer ${res.json().token}` };
  };
  const idOf = (email: string) =>
    (db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id;

  return { app, db, register, idOf };
}

test('a non-admin is refused every admin route, with a valid token', async () => {
  const { app, register, idOf } = await fresh();
  await register('boss@example.com');
  const nobody = await register('nobody@example.com');
  const id = idOf('nobody@example.com');

  const calls = [
    { method: 'GET' as const, url: '/admin/users' },
    { method: 'PATCH' as const, url: `/admin/users/${id}`, payload: { tier: 'pro' } },
    { method: 'DELETE' as const, url: `/admin/users/${id}/sessions` },
  ];
  for (const c of calls) {
    const res = await app.inject({ ...c, headers: nobody });
    assert.equal(res.statusCode, 403, `${c.method} ${c.url} answered ${res.statusCode}`);
  }
});

test('the user list reports tier, state and counts', async () => {
  const { app, db, register, idOf } = await fresh();
  const boss = await register('boss@example.com');
  await register('user@example.com');

  const uid = idOf('user@example.com');
  db.prepare(`INSERT INTO notes (id, user_id, title, body, pinned, created_at, updated_at)
              VALUES ('n1', ?, 't', 'b', 0, 1, 1)`).run(uid);

  const res = await app.inject({ method: 'GET', url: '/admin/users', headers: boss });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.total, 2);
  const row = body.users.find((u: { email: string }) => u.email === 'user@example.com');
  assert.deepEqual(
    { tier: row.tier, disabled: row.disabled, noteCount: row.noteCount, sessionCount: row.sessionCount },
    { tier: 'free', disabled: false, noteCount: 1, sessionCount: 1 },
  );
});

test('promoting a user grants the AI proxy on their next request', async () => {
  const { app, register, idOf } = await fresh();
  const boss = await register('boss@example.com');
  const user = await register('user@example.com');
  const ask = () => app.inject({
    method: 'POST', url: '/ai/complete', headers: user,
    payload: { task: 'translate', text: 'hello', targetLang: 'fa' },
  });

  assert.equal((await ask()).statusCode, 403);
  const patch = await app.inject({
    method: 'PATCH', url: `/admin/users/${idOf('user@example.com')}`,
    headers: boss, payload: { tier: 'pro' },
  });
  assert.equal(patch.statusCode, 200, patch.body);
  // 503, not 403: past the tier gate, and this app was built with no provider.
  assert.equal((await ask()).statusCode, 503);
});

test('an admin cannot demote or disable themselves', async () => {
  const { app, register, idOf } = await fresh();
  const boss = await register('boss@example.com');
  const self = idOf('boss@example.com');

  for (const payload of [{ tier: 'free' }, { disabled: true }]) {
    const res = await app.inject({
      method: 'PATCH', url: `/admin/users/${self}`, headers: boss, payload,
    });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
  // Promoting themselves is fine — it takes nothing away and locks nobody out.
  assert.equal(
    (await app.inject({
      method: 'PATCH', url: `/admin/users/${self}`, headers: boss, payload: { tier: 'pro' },
    })).statusCode,
    200,
  );
});

test('disabling revokes access through sessionGuard', async () => {
  const { app, register, idOf } = await fresh();
  const boss = await register('boss@example.com');
  const user = await register('user@example.com');
  assert.equal((await app.inject({ method: 'GET', url: '/auth/me', headers: user })).statusCode, 200);

  await app.inject({
    method: 'PATCH', url: `/admin/users/${idOf('user@example.com')}`,
    headers: boss, payload: { disabled: true },
  });
  assert.equal((await app.inject({ method: 'GET', url: '/auth/me', headers: user })).statusCode, 401);
});

test('forcing a sign-out drops every session of that user only', async () => {
  const { app, db, register, idOf } = await fresh();
  const boss = await register('boss@example.com');
  const user = await register('user@example.com');

  const res = await app.inject({
    method: 'DELETE', url: `/admin/users/${idOf('user@example.com')}/sessions`, headers: boss,
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((await app.inject({ method: 'GET', url: '/auth/me', headers: user })).statusCode, 401);
  // The admin's own session survived.
  assert.equal((await app.inject({ method: 'GET', url: '/auth/me', headers: boss })).statusCode, 200);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?')
      .get(idOf('user@example.com')) as { n: number }).n,
    0,
  );
});

test('a patch on an unknown user is a 404, and a bad tier never reaches the database', async () => {
  const { app, register } = await fresh();
  const boss = await register('boss@example.com');

  assert.equal(
    (await app.inject({
      method: 'PATCH', url: '/admin/users/no-such-id', headers: boss, payload: { tier: 'pro' },
    })).statusCode,
    404,
  );
  assert.equal(
    (await app.inject({
      method: 'PATCH', url: '/admin/users/no-such-id', headers: boss, payload: { tier: 'enterprise' },
    })).statusCode,
    400,
  );
});
