import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/index.ts';
import { openDb } from '../src/db.ts';

const settings = (over: Record<string, unknown> = {}) => ({
  version: 3,
  theme: 'dark',
  syncIntervalMs: 300000,
  ai: { mode: 'proxy', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', targetLang: 'fa', cache: true },
  experimentalEditor: false,
  updatedAt: 1000,
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

  const put = (headers: Record<string, string>, body: unknown, updatedAt: number) =>
    app.inject({ method: 'PUT', url: '/settings', headers, payload: { settings: body, updatedAt } });

  const get = (headers: Record<string, string>) =>
    app.inject({ method: 'GET', url: '/settings', headers });

  return { app, signUp, put, get };
}

test('settings round-trip', async () => {
  const { signUp, put, get } = await fresh();
  const a = await signUp('a@example.com');

  assert.equal((await put(a, settings(), 1000)).statusCode, 200);
  const res = await get(a);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().settings.theme, 'dark');
  assert.equal(res.json().updatedAt, 1000);
});

test('a user with no stored settings gets null, not a 404', async () => {
  const { signUp, get } = await fresh();
  const a = await signUp('a@example.com');
  const res = await get(a);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().settings, null);
  assert.equal(res.json().updatedAt, 0);
});

test('older write loses, and the winner is returned', async () => {
  const { signUp, put, get } = await fresh();
  const a = await signUp('a@example.com');

  await put(a, settings({ theme: 'dark' }), 2000);
  const stale = await put(a, settings({ theme: 'light' }), 1000);
  assert.equal(stale.statusCode, 200);
  assert.equal(stale.json().settings.theme, 'dark', 'an older write overwrote a newer one');
  assert.equal(stale.json().updatedAt, 2000);
  assert.equal((await get(a)).json().settings.theme, 'dark');
});

test('newer write wins', async () => {
  const { signUp, put, get } = await fresh();
  const a = await signUp('a@example.com');
  await put(a, settings({ theme: 'dark' }), 1000);
  await put(a, settings({ theme: 'light' }), 3000);
  assert.equal((await get(a)).json().settings.theme, 'light');
});

test('settings are per user — B cannot read or overwrite A', async () => {
  const { signUp, put, get } = await fresh();
  const a = await signUp('a@example.com');
  const b = await signUp('b@example.com');

  await put(a, settings({ theme: 'dark' }), 5000);
  assert.equal((await get(b)).json().settings, null, "B read A's settings");

  await put(b, settings({ theme: 'light' }), 9000);
  assert.equal((await get(a)).json().settings.theme, 'dark', "B overwrote A's settings");
});

test('unauthenticated requests are rejected', async () => {
  const { app } = await fresh();
  assert.equal((await app.inject({ method: 'GET', url: '/settings' })).statusCode, 401);
  assert.equal(
    (await app.inject({ method: 'PUT', url: '/settings', payload: { settings: {}, updatedAt: 1 } })).statusCode,
    401,
  );
});
