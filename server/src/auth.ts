import { randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';

const MIN_PASSWORD = 8;

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

/** The token's subject. Every sync query scopes on this, never on client input. */
export function userId(req: FastifyRequest): string {
  return (req.user as { sub: string }).sub;
}

export async function authRoutes(app: FastifyInstance, db: Db) {
  const insertUser = db.prepare(
    'INSERT INTO users (id, email, password, created_at) VALUES (?, ?, ?, ?)',
  );
  const findUser = db.prepare('SELECT id, email, password FROM users WHERE email = ?');
  const findById = db.prepare('SELECT id, email FROM users WHERE id = ?');

  const token = (user: { id: string; email: string }) =>
    app.jwt.sign({ sub: user.id, email: user.email }, { expiresIn: '30d' });

  app.post('/auth/register', { schema: { body: credentials } }, async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };
    const normalized = email.trim().toLowerCase();

    if (findUser.get(normalized)) {
      return reply.code(409).send({ error: 'email already registered' });
    }

    const id = randomUUID();
    insertUser.run(id, normalized, await hash(password), Date.now());
    return { token: token({ id, email: normalized }) };
  });

  app.post('/auth/login', { schema: { body: credentials } }, async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };
    const user = findUser.get(email.trim().toLowerCase()) as UserRow | undefined;

    // Same response for "no such user" and "wrong password" — no account enumeration.
    if (!user || !(await verify(user.password, password))) {
      return reply.code(401).send({ error: 'invalid credentials' });
    }
    return { token: token(user) };
  });

  app.get('/auth/me', { onRequest: [app.authenticate] }, async req => {
    return findById.get(userId(req));
  });
}