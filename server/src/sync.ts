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
    // Must ship in the same change as the client's toWire: `additionalProperties:
    // false` means a client sending groupId without this has its ENTIRE push rejected.
    groupId: { type: ['string', 'null'], maxLength: 64 },
    // Same rule as groupId: this must ship with the client's toWire, or a push carrying
    // it is rejected whole. Enumerated rather than a free string — it goes straight back
    // out as a `dir` attribute.
    dir: { type: 'string', enum: ['auto', 'rtl', 'ltr'] },
  },
} as const;

const MAX_GROUP_NAME = 60;
const MAX_GROUPS_PER_PUSH = 200;

const groupSchema = {
  type: 'object',
  required: ['id', 'name', 'createdAt', 'updatedAt'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 64 },
    name: { type: 'string', maxLength: MAX_GROUP_NAME },
    color: { type: ['string', 'null'], maxLength: 20 },
    order: { type: 'number' },
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
  groupId: string | null;
  dir: 'auto' | 'rtl' | 'ltr';
}

interface WireGroup {
  id: string;
  name: string;
  color: string | null;
  order: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

interface GroupRow {
  id: string;
  name: string;
  color: string | null;
  sort_order: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
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
  group_id: string | null;
  dir: string | null;
}

const toWireGroup = (r: GroupRow): WireGroup => ({
  id: r.id,
  name: r.name,
  color: r.color,
  order: r.sort_order,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
});

const toWire = (r: Row): WireNote => ({
  id: r.id,
  title: r.title,
  body: r.body,
  color: r.color,
  pinned: r.pinned === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deletedAt: r.deleted_at,
  groupId: r.group_id,
  // NULL means a row written before v4, not an unset preference.
  dir: r.dir === 'rtl' || r.dir === 'ltr' ? r.dir : 'auto',
});

export async function syncRoutes(app: FastifyInstance, db: Db) {
  // Every statement filters on user_id from the token. A note id belonging to
  // another user matches nothing and is never read or overwritten.
  const stored = db.prepare('SELECT updated_at FROM notes WHERE id = ? AND user_id = ?');
  const upsert = db.prepare(`
    INSERT INTO notes (id, user_id, title, body, color, pinned, created_at, updated_at, deleted_at, group_id, dir)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id, user_id) DO UPDATE SET
      title = excluded.title, body = excluded.body, color = excluded.color,
      pinned = excluded.pinned, updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at, group_id = excluded.group_id,
      dir = excluded.dir
  `);

  const storedGroup = db.prepare('SELECT updated_at FROM groups WHERE id = ? AND user_id = ?');
  const upsertGroup = db.prepare(`
    INSERT INTO groups (id, user_id, name, color, sort_order, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id, user_id) DO UPDATE SET
      name = excluded.name, color = excluded.color, sort_order = excluded.sort_order,
      updated_at = excluded.updated_at, deleted_at = excluded.deleted_at
  `);
  const groupsSince = db.prepare(
    'SELECT * FROM groups WHERE user_id = ? AND updated_at > ? ORDER BY updated_at',
  );
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
          groups: { type: 'array', maxItems: MAX_GROUPS_PER_PUSH, items: groupSchema },
        },
      },
    },
  }, async req => {
    const uid = userId(req);
    const { notes, groups = [] } = req.body as { notes: WireNote[]; groups?: WireGroup[] };
    const rejected: string[] = [];
    const rejectedGroups: string[] = [];

    for (const n of notes) {
      const row = stored.get(n.id, uid) as { updated_at: number } | undefined;
      // Last-write-wins. Equal timestamps are a no-op write, not a conflict.
      if (row && row.updated_at > n.updatedAt) {
        rejected.push(n.id);
        continue;
      }
      upsert.run(
        n.id, uid, n.title, n.body, n.color ?? null, n.pinned ? 1 : 0,
        n.createdAt, n.updatedAt, n.deletedAt ?? null, n.groupId ?? null, n.dir ?? 'auto',
      );
    }

    for (const g of groups) {
      const row = storedGroup.get(g.id, uid) as { updated_at: number } | undefined;
      if (row && row.updated_at > g.updatedAt) {
        rejectedGroups.push(g.id);
        continue;
      }
      upsertGroup.run(
        g.id, uid, g.name, g.color ?? null, g.order ?? 1,
        g.createdAt, g.updatedAt, g.deletedAt ?? null,
      );
    }

    return { serverTime: Date.now(), rejected, rejectedGroups };
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
      groups: (groupsSince.all(userId(req), cursor) as unknown as GroupRow[]).map(toWireGroup),
      serverTime: Date.now(),
    };
  });
}