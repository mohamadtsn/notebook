import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import { openDb, type Db } from './db.ts';
import { authRoutes, sessionGuard, userId } from './auth.ts';
import { syncRoutes } from './sync.ts';
import { settingsRoutes } from './settings.ts';
import { aiRoutes, providerFromEnv, type Provider } from './ai.ts';
import { adminRoutes } from './admin.ts';
import { attachmentRoutes, MAX_FILE_BYTES } from './attachments.ts';
import { isAdminEmail } from './tiers.ts';

const BODY_LIMIT = 2 * 1024 * 1024;

export async function buildApp(opts: {
  db: Db; jwtSecret: string; origin: string;
  /** Injected by the tests so a run never makes a network call. */
  aiProvider?: Provider;
  /** Where attachment blobs live. The tests point this at a temp directory. */
  attachmentsDir?: string;
}) {
  const app = Fastify({ bodyLimit: BODY_LIMIT, logger: process.env.NODE_ENV !== 'test' });

  // `methods` is spelled out because @fastify/cors defaults to GET/HEAD/POST, and the
  // browser then fails the preflight for anything else. PUT has always been needed by
  // /settings; DELETE arrived with /sessions and was the one that caught this.
  await app.register(cors, {
    origin: opts.origin,
    credentials: true,
    // Spelled out because @fastify/cors defaults to GET/HEAD/POST. PATCH arrived with
    // /admin/users/:id and, like DELETE before it, fails the preflight if left out.
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  await app.register(jwt, { secret: opts.jwtSecret });
  // `bodyLimit` above does not apply to a multipart stream, so the per-file ceiling is
  // stated here too — the parser truncates the stream at it rather than buffering.
  await app.register(multipart, { limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
  await app.register(rateLimit, {
    max: 10,
    timeWindow: '1 minute',
    // Only the credential endpoints are throttled; sync is a normal authed workload.
    keyGenerator: req => req.ip,
    // Credential endpoints and the AI endpoint are throttled; sync is a normal authed
    // workload, and so are /sessions (a valid token, only the caller's own rows).
    // A route left in the allowList cannot have its own rateLimit config.
    allowList: req => !(
      req.url.startsWith('/auth/')
      || req.url.startsWith('/ai/')
      // Maintenance routes that change other people's accounts are not a normal authed
      // workload; they stay throttled with the credential endpoints.
      || req.url.startsWith('/admin/')
      // Only the UPLOAD. A route left in the allowList cannot carry a `config.rateLimit`
      // of its own, so POST /attachments has to come out to get one — but downloading is
      // an ordinary authenticated read, and a note may hold twenty files. Matching the
      // whole prefix would have throttled opening such a note to the credential budget.
      || (req.method === 'POST' && req.url.startsWith('/attachments'))
    ),
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

  /**
   * Tier gate. The tier is read from the database per request, never from the token —
   * a promotion made in the admin panel has to take effect on the next request, not in
   * thirty days when the token expires.
   *
   * 403 `tier_required` is a distinct answer from the AI route's 503 `ai_not_configured`:
   * "not allowed" and "not set up" are different problems and the UI says different
   * things about them.
   */
  const findTier = opts.db.prepare('SELECT tier FROM users WHERE id = ?');
  app.decorate('requirePro', async (req: FastifyRequest, reply: FastifyReply) => {
    const row = findTier.get(userId(req)) as { tier: string } | undefined;
    if (row?.tier !== 'pro') return reply.code(403).send({ error: 'tier_required' });
  });

  /**
   * Admin gate. Authority is the ADMIN_EMAILS env, read per request — never a token
   * claim (a token minted before a revocation would carry it for thirty days) and never
   * a database column, which a compromised admin could write to promote themselves.
   *
   * The email is read from the row rather than the token's claim for the same reason
   * `requirePro` reads the tier there: one lookup, one source of truth.
   */
  const findEmail = opts.db.prepare('SELECT email FROM users WHERE id = ?');
  app.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    const row = findEmail.get(userId(req)) as { email: string } | undefined;
    if (!row || !isAdminEmail(row.email)) return reply.code(403).send({ error: 'forbidden' });
  });

  app.get('/health', async () => ({ ok: true }));
  await app.register(async a => authRoutes(a, opts.db));
  await app.register(async a => syncRoutes(a, opts.db));
  await app.register(async a => settingsRoutes(a, opts.db));
  await app.register(async a => aiRoutes(a, opts.db, opts.aiProvider ?? providerFromEnv()));
  await app.register(async a => adminRoutes(a, opts.db));
  await app.register(async a => attachmentRoutes(
    a, opts.db, opts.attachmentsDir ?? process.env.ATTACHMENTS_DIR ?? './data/attachments',
  ));

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