import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/index.ts';
import { openDb } from '../src/db.ts';

interface Session {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  userAgent: string | null;
  current: boolean;
}

async function fresh() {
  const app = await buildApp({
    db: openDb(':memory:'),
    jwtSecret: 'x'.repeat(32),
    origin: 'http://localhost:5173',
  });

  const register = async (email: string, userAgent = 'test-agent') => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers: { 'user-agent': userAgent },
      payload: { email, password: 'correct horse battery' },
    });
    assert.equal(res.statusCode, 200, res.body);
    return res.json().token as string;
  };

  const login = async (email: string, userAgent = 'test-agent') => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      headers: { 'user-agent': userAgent },
      payload: { email, password: 'correct horse battery' },
    });
    assert.equal(res.statusCode, 200, res.body);
    return res.json().token as string;
  };

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const list = async (token: string) => {
    const res = await app.inject({ method: 'GET', url: '/sessions', headers: auth(token) });
    assert.equal(res.statusCode, 200, res.body);
    return res.json().sessions as Session[];
  };

  return { app, register, login, auth, list };
}

test('a sign-in creates one session, and it is marked current', async () => {
  const { register, list } = await fresh();
  const token = await register('one@example.com', 'Mozilla/5.0 (Macintosh) Safari/605');

  const sessions = await list(token);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].current, true);
  assert.equal(sessions[0].userAgent, 'Mozilla/5.0 (Macintosh) Safari/605');
});

test('each device gets its own session, and only the caller is current', async () => {
  const { register, login, list } = await fresh();
  const first = await register('two@example.com', 'device-a');
  const second = await login('two@example.com', 'device-b');

  const seen = await list(second);
  assert.equal(seen.length, 2);
  assert.deepEqual(
    seen.filter(s => s.current).map(s => s.userAgent),
    ['device-b'],
  );
  // The other device is still usable — signing in somewhere else revokes nothing.
  assert.equal((await list(first)).length, 2);
});

test('revoking a session kills that token on its very next request', async () => {
  const { app, register, login, auth, list } = await fresh();
  const victim = await register('three@example.com', 'device-a');
  const keeper = await login('three@example.com', 'device-b');

  const victimId = (await list(keeper)).find(s => s.userAgent === 'device-a')!.id;

  // Still good before the revoke — otherwise this test would pass for the wrong reason.
  assert.equal(
    (await app.inject({ method: 'GET', url: '/sync/pull?since=0', headers: auth(victim) })).statusCode,
    200,
  );

  const gone = await app.inject({
    method: 'DELETE', url: `/sessions/${victimId}`, headers: auth(keeper),
  });
  assert.equal(gone.statusCode, 200, gone.body);

  // The JWT still verifies — its signature and expiry are untouched. The session row is
  // what is missing, and that is the whole point of the guard.
  assert.equal(
    (await app.inject({ method: 'GET', url: '/sync/pull?since=0', headers: auth(victim) })).statusCode,
    401,
  );
  assert.equal((await list(keeper)).length, 1);
});

test('a user cannot revoke another user session', async () => {
  const { app, register, auth, list } = await fresh();
  const mine = await register('owner@example.com');
  const theirs = await register('other@example.com');

  const theirId = (await list(theirs))[0].id;
  const res = await app.inject({
    method: 'DELETE', url: `/sessions/${theirId}`, headers: auth(mine),
  });
  // Scoped on the token's user, so it matches nothing — and their token still works.
  assert.equal(res.statusCode, 200, res.body);
  assert.equal((await list(theirs)).length, 1);
});

test('revoke-others leaves exactly the calling device', async () => {
  const { app, register, login, auth, list } = await fresh();
  await register('many@example.com', 'device-a');
  await login('many@example.com', 'device-b');
  const here = await login('many@example.com', 'device-c');

  assert.equal((await list(here)).length, 3);

  const res = await app.inject({ method: 'DELETE', url: '/sessions', headers: auth(here) });
  assert.equal(res.statusCode, 200, res.body);

  const left = await list(here);
  assert.equal(left.length, 1);
  assert.equal(left[0].userAgent, 'device-c');
  assert.equal(left[0].current, true);
});

test('revoking the current session signs this device out', async () => {
  const { app, register, auth, list } = await fresh();
  const token = await register('self@example.com');
  const id = (await list(token))[0].id;

  await app.inject({ method: 'DELETE', url: `/sessions/${id}`, headers: auth(token) });
  const after = await app.inject({ method: 'GET', url: '/sessions', headers: auth(token) });
  assert.equal(after.statusCode, 401);
});

test('a token minted without a session is refused, not grandfathered', async () => {
  const { app, register, auth } = await fresh();
  // Prove the guard is what rejects it: same secret, same claims, no `jti`, so the
  // signature verifies and only the missing session row can be the reason.
  await register('legacy@example.com');
  const forged = app.jwt.sign({ sub: 'whoever', email: 'legacy@example.com' }, { expiresIn: '30d' });

  const res = await app.inject({
    method: 'GET', url: '/sync/pull?since=0', headers: auth(forged),
  });
  assert.equal(res.statusCode, 401);
});

test('/sessions requires a token', async () => {
  const { app } = await fresh();
  assert.equal((await app.inject({ method: 'GET', url: '/sessions' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'DELETE', url: '/sessions' })).statusCode, 401);
});
