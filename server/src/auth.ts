import { randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';

const MIN_PASSWORD = 8;
/** Matches the token's `expiresIn`. A row past this can never authenticate again. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** `last_seen_at` is a nicety; writing it per request would turn every read into a write. */
const TOUCH_AFTER_MS = 5 * 60 * 1000;
/** A UA string is attacker-controlled and unbounded. Stored truncated. */
const MAX_USER_AGENT = 300;

const credentials = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
    password: { type: 'string', minLength: MIN_PASSWORD, maxLength: 200 },
  },
} as const;

interface UserRow {
  id: string;
  email: string;
  password: string;
}

interface SessionRow {
  id: string;
  created_at: number;
  last_seen_at: number;
  user_agent: string | null;
}

/** The token's subject. Every sync query scopes on this, never on client input. */
export function userId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

/** The token's session id. `undefined` for a token minted before sessions existed. */
export function sessionId(req: FastifyRequest): string | undefined {
  return (req.user as { jti?: string }).jti;
}

/**
 * The revocation check, run on every authenticated request after `jwtVerify`.
 *
 * A token with no `jti` predates this feature and is refused outright rather than
 * grandfathered: accepting it would leave a 30-day window in which «خروج از این دستگاه»
 * silently does nothing, which is worse than asking everyone to sign in once more.
 * Signing out keeps every local note, so nobody loses data over it.
 */
export function sessionGuard(db: Db) {
  const find = db.prepare('SELECT last_seen_at FROM sessions WHERE id = ? AND user_id = ?');
  const touch = db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?');

  return (req: FastifyRequest): boolean => {
    const jti = sessionId(req);
    if (!jti) return false;

    const row = find.get(jti, userId(req)) as { last_seen_at: number } | undefined;
    if (!row) return false;

    const now = Date.now();
    if (now - row.last_seen_at > TOUCH_AFTER_MS) touch.run(now, jti);
    return true;
  };
}

export async function authRoutes(app: FastifyInstance, db: Db) {
  const insertUser = db.prepare(
    'INSERT INTO users (id, email, password, created_at) VALUES (?, ?, ?, ?)',
  );
  const findUser = db.prepare('SELECT id, email, password FROM users WHERE email = ?');
  const findById = db.prepare('SELECT id, email FROM users WHERE id = ?');

  const insertSession = db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, last_seen_at, user_agent) VALUES (?, ?, ?, ?, ?)',
  );
  const listSessions = db.prepare(
    'SELECT id, created_at, last_seen_at, user_agent FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC',
  );
  const dropSession = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?');
  const dropOthers = db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?');
  const dropExpired = db.prepare('DELETE FROM sessions WHERE user_id = ? AND created_at < ?');

  /**
   * Mints a token AND the session row it names. The two are written together on
   * purpose: a token whose row is missing cannot authenticate, so a half-done sign-in
   * fails closed rather than issuing a credential nothing can revoke.
   */
  const issue = (user: { id: string; email: string }, req: FastifyRequest) => {
    const jti = randomUUID();
    const now = Date.now();
    const ua = req.headers['user-agent'];
    insertSession.run(
      jti, user.id, now, now,
      typeof ua === 'string' ? ua.slice(0, MAX_USER_AGENT) : null,
    );
    // No IP column. The device list needs a label, and a label comes from the UA; an
    // address is personal data this app has no use for.
    return app.jwt.sign({ sub: user.id, email: user.email, jti }, { expiresIn: '30d' });
  };

  app.post('/auth/register', { schema: { body: credentials } }, async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };
    const normalized = email.trim().toLowerCase();

    if (findUser.get(normalized)) {
      return reply.code(409).send({ error: 'email already registered' });
    }

    const id = randomUUID();
    insertUser.run(id, normalized, await hash(password), Date.now());
    return { token: issue({ id, email: normalized }, req) };
  });

  app.post('/auth/login', { schema: { body: credentials } }, async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };
    const user = findUser.get(email.trim().toLowerCase()) as UserRow | undefined;

    // Same response for "no such user" and "wrong password" — no account enumeration.
    if (!user || !(await verify(user.password, password))) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    return { token: issue(user, req) };
  });

  app.get('/auth/me', { onRequest: [app.authenticate] }, async req => {
    return findById.get(userId(req));
  });

  /**
   * Deliberately NOT under `/auth/` — that prefix is rate limited at 10/min per IP
   * because it takes credentials. These take a valid token and only ever touch the
   * caller's own rows, so they belong with sync: authenticated, unthrottled. Revoking
   * five devices would otherwise spend the whole credential budget.
   */
  app.get('/sessions', { onRequest: [app.authenticate] }, async req => {
    const uid = userId(req);
    // Rows past the token lifetime can never authenticate again; drop them on the way
    // past rather than listing devices that are already signed out.
    dropExpired.run(uid, Date.now() - SESSION_TTL_MS);

    const current = sessionId(req);
    return {
      sessions: (listSessions.all(uid) as unknown as SessionRow[]).map(s => ({
        id: s.id,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        userAgent: s.user_agent,
        current: s.id === current,
      })),
    };
  });

  app.delete('/sessions/:id', {
    onRequest: [app.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: { id: { type: 'string', maxLength: 64 } },
      },
    },
  }, async req => {
    const { id } = req.params as { id: string };
    // Scoped on the token's user, like every sync statement: another account's session
    // id matches nothing. Revoking your own is allowed — it is a sign-out.
    dropSession.run(id, userId(req));
    return { ok: true };
  });

  /** Everything except the caller. The device in hand stays signed in. */
  app.delete('/sessions', { onRequest: [app.authenticate] }, async req => {
    dropOthers.run(userId(req), sessionId(req)!);
    return { ok: true };
  });
}
