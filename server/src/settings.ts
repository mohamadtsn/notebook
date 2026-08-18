import type { FastifyInstance } from 'fastify';
import type { Db } from './db.ts';
import { userId } from './auth.ts';

/** A preferences blob, not a document. 16KB is far above any legitimate size. */
const MAX_JSON = 16 * 1024;

export async function settingsRoutes(app: FastifyInstance, db: Db) {
  // Keyed on the user id from the token. There is no client-supplied id at all here.
  const read = db.prepare('SELECT json, updated_at FROM settings WHERE user_id = ?');
  const write = db.prepare(`
    INSERT INTO settings (user_id, json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at
  `);

  app.get('/settings', { onRequest: [app.authenticate] }, async req => {
    const row = read.get(userId(req)) as { json: string; updated_at: number } | undefined;
    // Absent settings are a normal state for a new account, not an error.
    if (!row) return { settings: null, updatedAt: 0 };
    return { settings: JSON.parse(row.json) as unknown, updatedAt: row.updated_at };
  });

  app.put('/settings', {
    onRequest: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['settings', 'updatedAt'],
        additionalProperties: false,
        properties: {
          settings: { type: 'object' },
          updatedAt: { type: 'integer', minimum: 0 },
        },
      },
    },
  }, async (req, reply) => {
    const uid = userId(req);
    const { settings, updatedAt } = req.body as { settings: unknown; updatedAt: number };

    const json = JSON.stringify(settings);
    if (json.length > MAX_JSON) return reply.code(413).send({ error: 'settings_too_large' });

    const row = read.get(uid) as { json: string; updated_at: number } | undefined;
    // Whole-object last-write-wins. Per-field merge is not worth its complexity for a
    // preferences blob — and the loser is returned so the client can adopt the winner
    // in the same round trip instead of waiting for the next pull.
    if (row && row.updated_at > updatedAt) {
      return { settings: JSON.parse(row.json) as unknown, updatedAt: row.updated_at };
    }

    write.run(uid, json, updatedAt);
    return { settings, updatedAt };
  });
}
