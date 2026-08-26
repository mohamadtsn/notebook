import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { openDb, type Db } from './db.ts';
import { authRoutes, sessionGuard } from './auth.ts';
import { syncRoutes } from './sync.ts';
import { settingsRoutes } from './settings.ts';
import { aiRoutes, providerFromEnv, type Provider } from './ai.ts';

const BODY_LIMIT = 2 * 1024 * 1024;

export async function buildApp(opts: {
  db: Db; jwtSecret: string; origin: string;
  /** Injected by the tests so a run never makes a network call. */
  aiProvider?: Provider;
}) {
  const app = Fastify({ bodyLimit: BODY_LIMIT, logger: process.env.NODE_ENV !== 'test' });

  // `methods` is spelled out because @fastify/cors defaults to GET/HEAD/POST, and the
  // browser then fails the preflight for anything else. PUT has always been needed by
  // /settings; DELETE arrived with /sessions and was the one that caught this.
  await app.register(cors, {
    origin: opts.origin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'],
  });
  await app.register(jwt, { secret: opts.jwtSecret });
  await app.register(rateLimit, {
    max: 10,
    timeWindow: '1 minute',
    // Only the credential endpoints are throttled; sync is a normal authed workload.
    keyGenerator: req => req.ip,
    // Credential endpoints and the AI endpoint are throttled; sync is a normal authed
    // workload, and so are /sessions (a valid token, only the caller's own rows).
    // A route left in the allowList cannot have its own rateLimit config.
    allowList: req => !(req.url.startsWith('/auth/') || req.url.startsWith('/ai/')),
  });

  // A verified signature is no longer enough: the token must also name a session row
  // that still exists. That is what makes revocation real — see sessionGuard.
  const hasSession = sessionGuard(opts.db);

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!hasSession(req)) return reply.code(401).send({ error: 'unauthorized' });
  });

  app.get('/health', async () => ({ ok: true }));
  await app.register(async a => authRoutes(a, opts.db));
  await app.register(async a => syncRoutes(a, opts.db));
  await app.register(async a => settingsRoutes(a, opts.db));
  await app.register(async a => aiRoutes(a, opts.db, opts.aiProvider ?? providerFromEnv()));

  return app;
}

// Entry point only when run directly; the tests import buildApp.
if (import.meta.filename === process.argv[1]) {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    console.error('JWT_SECRET is required and must be at least 32 characters. Refusing to start.');
    process.exit(1);
  }

  const app = await buildApp({
    db: openDb(process.env.DB_FILE ?? './data/notebook.db'),
    jwtSecret,
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  });

  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
}