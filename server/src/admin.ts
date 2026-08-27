import type { FastifyInstance } from 'fastify';
import type { Db } from './db.ts';
import { userId } from './auth.ts';
import { TIERS, type Tier } from './tiers.ts';

/** One page. A maintenance screen that can ask for ten thousand rows is a footgun. */
const MAX_LIMIT = 100;

interface UserRow {
  id: string;
  email: string;
  tier: Tier;
  disabled: number;
  created_at: number;
  note_count: number;
  session_count: number;
  ai_used_today: number;
  attachment_bytes: number;
}

const today = () => new Date().toISOString().slice(0, 10);

export async function adminRoutes(app: FastifyInstance, db: Db) {
  /**
   * Correlated subqueries rather than joins with GROUP BY: the counts come from four
   * different tables with four different filters, and a single grouped join would
   * multiply the rows before it counted them.
   */
  const list = db.prepare(`
    SELECT u.id, u.email, u.tier, u.disabled, u.created_at,
      (SELECT COUNT(*) FROM notes n WHERE n.user_id = u.id AND n.deleted_at IS NULL) AS note_count,
      (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id) AS session_count,
      (SELECT COALESCE(count, 0) FROM ai_usage a WHERE a.user_id = u.id AND a.day = ?) AS ai_used_today,
      (SELECT COALESCE(SUM(size), 0) FROM attachments t
        WHERE t.user_id = u.id AND t.deleted_at IS NULL) AS attachment_bytes
    FROM users u
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `);
  const total = db.prepare('SELECT COUNT(*) AS n FROM users');
  const findUser = db.prepare('SELECT id, email FROM users WHERE id = ?');
  // `tier_locked` is set by the same statement that writes the tier: from here on the
  // env seeds nothing for this account. See tiers.ts.
  const setTier = db.prepare('UPDATE users SET tier = ?, tier_locked = 1 WHERE id = ?');
  const setDisabled = db.prepare('UPDATE users SET disabled = ? WHERE id = ?');
  const dropSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?');

  app.get('/admin/users', {
    onRequest: [app.authenticate, app.requireAdmin],
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async req => {
    const { limit = 50, offset = 0 } = req.query as { limit?: number; offset?: number };
    const rows = list.all(today(), limit, offset) as unknown as UserRow[];
    return {
      total: (total.get() as { n: number }).n,
      users: rows.map(r => ({
        id: r.id,
        email: r.email,
        tier: r.tier,
        disabled: r.disabled === 1,
        createdAt: r.created_at,
        noteCount: r.note_count,
        sessionCount: r.session_count,
        aiUsedToday: r.ai_used_today,
        attachmentBytes: r.attachment_bytes,
      })),
    };
  });

  app.patch('/admin/users/:id', {
    onRequest: [app.authenticate, app.requireAdmin],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        additionalProperties: false,
        properties: { id: { type: 'string', maxLength: 64 } },
      },
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          tier: { type: 'string', enum: TIERS },
          disabled: { type: 'boolean' },
        },
      },
    },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const patch = req.body as { tier?: Tier; disabled?: boolean };

    const target = findUser.get(id) as { id: string; email: string } | undefined;
    if (!target) return reply.code(404).send({ error: 'not found' });

    /**
     * An admin may not disable or demote themselves. Not paternalism: ADMIN_EMAILS is
     * the only way into this panel, and the last admin locking their own account out
     * leaves nobody who can undo it without a shell on the box.
     */
    if (target.id === userId(req) && (patch.disabled === true || patch.tier === 'free')) {
      return reply.code(400).send({ error: 'cannot demote or disable yourself' });
    }

    if (patch.tier !== undefined) setTier.run(patch.tier, id);
    if (patch.disabled !== undefined) {
      setDisabled.run(patch.disabled ? 1 : 0, id);
      // Disabling takes effect at the disabled account's next request through
      // `sessionGuard` regardless; dropping the rows now makes it immediate.
      if (patch.disabled) dropSessions.run(id);
    }
    return { ok: true };
  });

  app.delete('/admin/users/:id/sessions', {
    onRequest: [app.authenticate, app.requireAdmin],
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
    dropSessions.run(id);
    return { ok: true };
  });

  // ponytail: no delete-user route. It is irreversible, it was not asked for, and
  // `disabled` covers the stated need — an account that cannot do anything. Add one
  // only when someone actually needs the rows gone, and make it export first.
}
