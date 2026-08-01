import type { FastifyInstance } from 'fastify';
import type { Db } from './db.ts';
import { userId } from './auth.ts';

const MAX_TITLE = 500;
const MAX_BODY = 200_000;
const MAX_NOTES_PER_PUSH = 500;

const noteSchema = {
  type: 'object',
  required: ['id', 'title', 'body', 'createdAt', 'updatedAt'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 64 },
    title: { type: 'string', maxLength: MAX_TITLE },
    body: { type: 'string', maxLength: MAX_BODY },
    color: { type: ['string', 'null'], maxLength: 20 },
    pinned: { type: 'boolean' },
    createdAt: { type: 'integer', minimum: 0 },
    updatedAt: { type: 'integer', minimum: 0 },
    deletedAt: { type: ['integer', 'null'], minimum: 0 },
  },
} as const;

interface WireNote {
  id: string;
  title: string;
  body: string;
  color: string | null;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

interface Row {
  id: string;
  title: string;
  body: string;
  color: string | null;
  pinned: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

const toWire = (r: Row): WireNote => ({
  id: r.id,
  title: r.title,
  body: r.body,
  color: r.color,
  pinned: r.pinned === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

export async function syncRoutes(app: FastifyInstance, db: Db) {
  // Every statement filters on user_id from the token. A note id belonging to
  // another user matches nothing and is never read or overwritten.
  const stored = db.prepare('SELECT updated_at FROM notes WHERE id = ? AND user_id = ?');
  const upsert = db.prepare(`
    INSERT INTO notes (id, user_id, title, body, color, pinned, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id, user_id) DO UPDATE SET
      title = excluded.title, body = excluded.body, color = excluded.color,
      pinned = excluded.pinned, updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at
  `);
  const since = db.prepare(
    'SELECT * FROM notes WHERE user_id = ? AND updated_at > ? ORDER BY updated_at',
  );

  app.post('/sync/push', {
    onRequest: [app.authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['notes'],
        additionalProperties: false,
        properties: {
          notes: { type: 'array', maxItems: MAX_NOTES_PER_PUSH, items: noteSchema },
        },
      },
    },
  }, async req => {
    const uid = userId(req);
    const { notes } = req.body as { notes: WireNote[] };
    const rejected: string[] = [];

    for (const n of notes) {
      const row = stored.get(n.id, uid) as { updated_at: number } | undefined;
      // Last-write-wins. Equal timestamps are a no-op write, not a conflict.
      if (row && row.updated_at > n.updatedAt) {
        rejected.push(n.id);
        continue;
      }
      upsert.run(
        n.id, uid, n.title, n.body, n.color ?? null, n.pinned ? 1 : 0,
        n.createdAt, n.updatedAt, n.deletedAt ?? null,
      );
    }

    return { serverTime: Date.now(), rejected };
  });

  app.get('/sync/pull', {
    onRequest: [app.authenticate],
    schema: {
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { since: { type: 'integer', minimum: 0, default: 0 } },
      },
    },
  }, async req => {
    const { since: cursor } = req.query as { since: number };
    return {
      notes: (since.all(userId(req), cursor) as unknown as Row[]).map(toWire),
      serverTime: Date.now(),
    };
  });
}