import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/index.ts';
import { openDb } from '../src/db.ts';

const PASSWORD = 'correct horse battery';

async function fresh() {
  const db = openDb(':memory:');
  const app = await buildApp({
    db,
    jwtSecret: 'x'.repeat(32),
    origin: 'http://localhost:5173',
    // A provider is injected so a 403 can never be confused with "not configured".
    aiProvider: async () => 'ok',
  });

  const register = async (email: string) => {
    const res = await app.inject({
      method: 'POST', url: '/auth/register', payload: { email, password: PASSWORD },
    });
    assert.equal(res.statusCode, 200, res.body);
    return { authorization: `Bearer ${res.json().token}` };
  };
  const login = async (email: string) => {
    const res = await app.inject({
      method: 'POST', url: '/auth/login', payload: { email, password: PASSWORD },
    });
    assert.equal(res.statusCode, 200, res.body);
    return { authorization: `Bearer ${res.json().token}` };
  };
  const me = (headers: Record<string, string>) =>
    app.inject({ method: 'GET', url: '/auth/me', headers });
  const ai = (headers: Record<string, string>) => app.inject({
    method: 'POST', url: '/ai/complete', headers,
    payload: { task: 'translate', text: 'hello', targetLang: 'fa' },
  });

  return { app, db, register, login, me, ai };
}

test('a free account is refused the AI proxy, and says so distinctly', async () => {
  process.env.PRO_EMAILS = '';
  const { register, ai } = await fresh();
  const a = await register('free@example.com');
  const res = await ai(a);
  assert.equal(res.statusCode, 403);
  // Not 503: "not allowed" and "not configured" are different answers.
  assert.equal(res.json().error, 'tier_required');
});

test('a whitelisted address is pro on register', async () => {
  process.env.PRO_EMAILS = 'pro@example.com';
  const { register, me, ai } = await fresh();
  const a = await register('pro@example.com');
  assert.equal((await me(a)).json().tier, 'pro');
  assert.equal((await ai(a)).statusCode, 200);
});

test('adding an address to the env takes effect at the next login', async () => {
  process.env.PRO_EMAILS = '';
  const { register, login, me } = await fresh();
  const before = await register('later@example.com');
  assert.equal((await me(before)).json().tier, 'free');

  process.env.PRO_EMAILS = 'LATER@Example.com ';   // case and padding are normalised
  const after = await login('later@example.com');
  assert.equal((await me(after)).json().tier, 'pro');
});

test('an admin demotion is not undone by a subsequent login', async () => {
  process.env.PRO_EMAILS = 'pro@example.com';
  const { db, register, login, me } = await fresh();
  const a = await register('pro@example.com');
  assert.equal((await me(a)).json().tier, 'pro');

  // What the admin panel writes: the tier, and the flag that says a human chose it.
  db.prepare("UPDATE users SET tier = 'free', tier_locked = 1 WHERE email = ?")
    .run('pro@example.com');

  const again = await login('pro@example.com');
  assert.equal((await me(again)).json().tier, 'free');
});

test('an empty allowlist promotes nobody', async () => {
  process.env.PRO_EMAILS = '';
  process.env.ADMIN_EMAILS = '';
  const { register, me } = await fresh();
  const body = (await me(await register('nobody@example.com'))).json();
  assert.equal(body.tier, 'free');
  assert.equal(body.isAdmin, false);
});

test('isAdmin comes from the env at request time, not from the token', async () => {
  process.env.ADMIN_EMAILS = '';
  const { register, me } = await fresh();
  const a = await register('boss@example.com');
  assert.equal((await me(a)).json().isAdmin, false);

  // Same token, promoted env: authority must follow the env, not the 30-day claim.
  process.env.ADMIN_EMAILS = 'boss@example.com';
  assert.equal((await me(a)).json().isAdmin, true);
});

test('a disabled account is refused on every authenticated route', async () => {
  process.env.PRO_EMAILS = 'gone@example.com';
  const { app, db, register } = await fresh();
  const a = await register('gone@example.com');
  assert.equal((await app.inject({ method: 'GET', url: '/sync/pull?since=0', headers: a })).statusCode, 200);

  db.prepare('UPDATE users SET disabled = 1 WHERE email = ?').run('gone@example.com');

  for (const url of ['/auth/me', '/sync/pull?since=0', '/sessions', '/settings']) {
    const res = await app.inject({ method: 'GET', url, headers: a });
    assert.equal(res.statusCode, 401, `${url} answered ${res.statusCode}`);
  }
});

test('disabling drops every session, so the other devices stop too', async () => {
  process.env.PRO_EMAILS = '';
  const { app, db, register, login } = await fresh();
  const phone = await register('two@example.com');
  const laptop = await login('two@example.com');

  db.prepare('UPDATE users SET disabled = 1 WHERE email = ?').run('two@example.com');
  // The phone's request is what trips the guard; the laptop must not survive it.
  assert.equal((await app.inject({ method: 'GET', url: '/auth/me', headers: phone })).statusCode, 401);

  db.prepare('UPDATE users SET disabled = 0 WHERE email = ?').run('two@example.com');
  assert.equal((await app.inject({ method: 'GET', url: '/auth/me', headers: laptop })).statusCode, 401);
});
