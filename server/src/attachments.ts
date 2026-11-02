import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Db } from './db.ts';
import { userId } from './auth.ts';

/** Per file. Enforced by the multipart parser as a hard stream limit, not a length check. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Per user, across every note. Checked before the write, against non-deleted rows. */
export const MAX_USER_BYTES = 200 * 1024 * 1024;
/** Per note. A note is a document, not a folder. */
export const MAX_PER_NOTE = 20;

/**
 * Dangerous file extensions that execute directly on desktop operating systems
 * or trigger scripting hosts. Developer files (.sh, .py, .ts, .ps1, etc.) are allowed.
 */
export const DISALLOWED_EXTENSIONS = new Set([
  'exe', 'dll', 'com', 'scr', 'pif', 'cpl', 'hta', 'msi', 'msp',
  'bat', 'cmd', 'vbs', 'vbe', 'wsf', 'wsh',
  'reg', 'inf', 'lnk',
  'dmg', 'pkg', 'apk',
]);

export const DISALLOWED_MIME = new Set([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-bat',
  'application/vnd.microsoft.portable-executable',
]);

export const BROWSER_EXECUTABLE_EXTENSIONS = new Set([
  'html', 'htm', 'xhtml', 'svg', 'svgz',
]);

export const BROWSER_EXECUTABLE_MIME = new Set([
  'text/html', 'image/svg+xml', 'application/xhtml+xml',
]);

const RTLO_AND_BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/g;
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

export function sanitizeFilename(raw: string): string {
  const cleaned = raw
    .replace(RTLO_AND_BIDI_CONTROLS, '')
    .replace(CONTROL_CHARS, '')
    .trim();
  return (cleaned || 'file').slice(0, 255);
}

export function getFileExtension(filename: string): string {
  const clean = sanitizeFilename(filename);
  const lastDot = clean.lastIndexOf('.');
  if (lastDot === -1 || lastDot === clean.length - 1) return '';
  return clean.slice(lastDot + 1).toLowerCase();
}

export function isDangerousFile(filename: string, mime?: string): boolean {
  const ext = getFileExtension(filename);
  if (ext && DISALLOWED_EXTENSIONS.has(ext)) return true;
  if (mime && DISALLOWED_MIME.has(mime.toLowerCase())) return true;
  return false;
}

export function isBrowserExecutable(filename: string, mime?: string): boolean {
  const ext = getFileExtension(filename);
  if (ext && BROWSER_EXECUTABLE_EXTENSIONS.has(ext)) return true;
  if (mime && BROWSER_EXECUTABLE_MIME.has(mime.toLowerCase())) return true;
  return false;
}

const MAX_NAME = 255;
const UUID = '^[0-9a-fA-F-]{36}$';

const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', pattern: UUID } },
} as const;

interface Row {
  id: string;
  note_id: string;
  name: string;
  mime: string;
  size: number;
  created_at: number;
}

/**
 * Where an attachment's bytes live.
 *
 * Both segments are server-controlled — `uid` comes from the verified token and `id` is a
 * uuid the schema has already pattern-matched — so traversal is unreachable by
 * construction. The containment assertion is here anyway: it costs one string compare,
 * and "unreachable by construction" is a claim that stops being true the day someone
 * relaxes the pattern. A test pins it.
 */
function blobPath(root: string, uid: string, id: string): string {
  const resolved = path.resolve(root, uid, id);
  const base = path.resolve(root) + path.sep;
  if (!resolved.startsWith(base)) throw new Error('attachment path escaped its root');
  return resolved;
}

export async function attachmentRoutes(app: FastifyInstance, db: Db, root: string) {
  const insert = db.prepare(`
    INSERT INTO attachments (id, user_id, note_id, name, mime, size, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  // Every statement filters on the user id from the token, like every sync statement.
  // The attachment id alone is never enough to reach a row.
  const find = db.prepare(
    'SELECT id, note_id, name, mime, size, created_at FROM attachments WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
  );
  const listForNote = db.prepare(
    'SELECT id, note_id, name, mime, size, created_at FROM attachments WHERE user_id = ? AND note_id = ? AND deleted_at IS NULL ORDER BY created_at',
  );
  const usedBytes = db.prepare(
    'SELECT COALESCE(SUM(size), 0) AS n FROM attachments WHERE user_id = ? AND deleted_at IS NULL',
  );
  const countForNote = db.prepare(
    'SELECT COUNT(*) AS n FROM attachments WHERE user_id = ? AND note_id = ? AND deleted_at IS NULL',
  );
  const tombstone = db.prepare(
    'UPDATE attachments SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
  );

  const toWire = (r: Row) => ({
    id: r.id,
    noteId: r.note_id,
    name: r.name,
    mime: r.mime,
    size: r.size,
    createdAt: r.created_at,
  });

  const guard = { onRequest: [app.authenticate, app.requirePro] };

  app.post('/attachments', {
    ...guard,
    // Uploads are expensive in a way sync is not, so this route carries its own limit
    // rather than riding the authenticated allowList. See index.ts.
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const uid = userId(req);

    const part = await req.file({ limits: { fileSize: MAX_FILE_BYTES, files: 1 } });
    if (!part) return reply.code(400).send({ error: 'no file' });

    // `noteId` must be sent BEFORE the file part: multipart is a stream, and a field
    // after the file has not been parsed yet by the time we get here.
    const noteId = (part.fields as Record<string, { value?: unknown } | undefined>)
      .noteId?.value;
    if (typeof noteId !== 'string' || !noteId || noteId.length > 64) {
      return reply.code(400).send({ error: 'noteId is required' });
    }

    const rawName = part.filename || 'file';
    if (isDangerousFile(rawName, part.mimetype)) {
      return reply.code(415).send({ error: 'disallowed file type' });
    }
    if ((countForNote.get(uid, noteId) as { n: number }).n >= MAX_PER_NOTE) {
      return reply.code(409).send({ error: 'too many attachments on this note' });
    }

    const used = (usedBytes.get(uid) as { n: number }).n;
    if (used >= MAX_USER_BYTES) return reply.code(413).send({ error: 'quota exceeded' });

    const id = randomUUID();
    const file = blobPath(root, uid, id);
    await mkdir(path.dirname(file), { recursive: true });

    try {
      await pipeline(part.file, createWriteStream(file));
    } catch {
      await rm(file, { force: true });
      return reply.code(500).send({ error: 'write failed' });
    }

    /**
     * The parser stops at MAX_FILE_BYTES rather than throwing, so what is on disk at
     * this point is a *prefix* of the file. Nothing is recorded and the bytes are
     * removed: a silently half-written attachment is worse than a refused one.
     */
    if (part.file.truncated) {
      await rm(file, { force: true });
      return reply.code(413).send({ error: 'file too large' });
    }

    const size = (await stat(file)).size;
    // The quota is re-checked against the real size: it could only be estimated before
    // the stream was consumed, and two concurrent uploads both pass the first check.
    if (used + size > MAX_USER_BYTES) {
      await rm(file, { force: true });
      return reply.code(413).send({ error: 'quota exceeded' });
    }

    // The stored filename is the uuid. `name` is metadata shown to the user and is
    // never joined into a path.
    const name = sanitizeFilename(rawName).slice(0, MAX_NAME);
    const now = Date.now();
    insert.run(id, uid, noteId, name, part.mimetype, size, now, now);
    return { id, noteId, name, mime: part.mimetype, size, createdAt: now };
  });

  app.get('/attachments', {
    ...guard,
    schema: {
      querystring: {
        type: 'object',
        required: ['noteId'],
        additionalProperties: false,
        properties: { noteId: { type: 'string', maxLength: 64 } },
      },
    },
  }, async req => {
    const { noteId } = req.query as { noteId: string };
    return {
      attachments: (listForNote.all(userId(req), noteId) as unknown as Row[]).map(toWire),
    };
  });

  app.get('/attachments/:id', {
    ...guard,
    schema: { params: idParams },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = userId(req);
    const row = find.get(id, uid) as Row | undefined;
    // 404, not 403: another account's id must not be distinguishable from a made-up one.
    if (!row) return reply.code(404).send({ error: 'not found' });

    const isExecutable = isBrowserExecutable(row.name, row.mime);
    const contentType = isExecutable ? 'application/octet-stream' : (row.mime || 'application/octet-stream');

    let res = reply
      .header('content-type', contentType)
      .header('content-length', String(row.size))
      // Never inline. The mime is client-declared, and a download that renders as a page
      // in this origin would be a stored-XSS delivery mechanism.
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`)
      .header('x-content-type-options', 'nosniff');

    if (isExecutable) {
      res = res.header('content-security-policy', "default-src 'none'; sandbox");
    }

    return res.send(createReadStream(blobPath(root, uid, id)));
  });

  app.delete('/attachments/:id', {
    ...guard,
    schema: { params: idParams },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = userId(req);
    if (!find.get(id, uid)) return reply.code(404).send({ error: 'not found' });

    // Tombstone first: the row is what sync propagates, and a deleted row whose bytes
    // are still on disk is recoverable. The other order is not.
    const now = Date.now();
    tombstone.run(now, now, id, uid);
    await rm(blobPath(root, uid, id), { force: true });
    return { ok: true };
  });
}
