import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildApp } from '../src/index.ts';
import { openDb } from '../src/db.ts';
import { MAX_FILE_BYTES, MAX_PER_NOTE, MAX_USER_BYTES } from '../src/attachments.ts';

const PASSWORD = 'correct horse battery';
const BOUNDARY = '----notebooktest';

/**
 * A multipart body built by hand rather than with a helper dependency. `noteId` comes
 * FIRST on purpose: multipart is a stream, and a field after the file part has not been
 * parsed by the time the route reads `part.fields`.
 */
function multipart(noteId: string, filename: string, mime: string, bytes: Buffer) {
  const head = Buffer.from(
    `--${BOUNDARY}\r\n`
    + 'content-disposition: form-data; name="noteId"\r\n\r\n'
    + `${noteId}\r\n`
    + `--${BOUNDARY}\r\n`
    + `content-disposition: form-data; name="file"; filename="${filename}"\r\n`
    + `content-type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);
  return {
    payload: Buffer.concat([head, bytes, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  };
}

async function fresh() {
  process.env.PRO_EMAILS = 'pro@example.com,other@example.com';
  process.env.ADMIN_EMAILS = '';
  const root = await mkdtemp(path.join(tmpdir(), 'notebook-attachments-'));
  const db = openDb(':memory:');
  const app = await buildApp({
    db, jwtSecret: 'x'.repeat(32), origin: 'http://localhost:5173', attachmentsDir: root,
  });

  const register = async (email: string) => {
    const res = await app.inject({
      method: 'POST', url: '/auth/register', payload: { email, password: PASSWORD },
    });
    assert.equal(res.statusCode, 200, res.body);
    return { authorization: `Bearer ${res.json().token}` };
  };

  const upload = (
    headers: Record<string, string>,
    { noteId = 'note-1', filename = 'a.pdf', mime = 'application/pdf', bytes = Buffer.from('hi') } = {},
  ) => {
    const m = multipart(noteId, filename, mime, bytes);
    return app.inject({
      method: 'POST', url: '/attachments',
      headers: { ...headers, ...m.headers },
      payload: m.payload,
    });
  };

  return { app, db, root, register, upload };
}

test('a free account cannot touch attachments at all', async () => {
  process.env.PRO_EMAILS = '';
  const { app, register, upload } = await fresh();
  process.env.PRO_EMAILS = '';
  const free = await register('free@example.com');

  assert.equal((await upload(free)).statusCode, 403);
  assert.equal(
    (await app.inject({ method: 'GET', url: '/attachments?noteId=note-1', headers: free })).statusCode,
    403,
  );
});

test('a pro account uploads, lists and downloads', async () => {
  const { app, register, upload } = await fresh();
  const a = await register('pro@example.com');

  const res = await upload(a, { filename: 'گزارش.pdf', bytes: Buffer.from('%PDF-1.4 hello') });
  assert.equal(res.statusCode, 200, res.body);
  const meta = res.json();
  assert.equal(meta.name, 'گزارش.pdf');
  assert.equal(meta.mime, 'application/pdf');
  assert.equal(meta.size, 14);

  const list = await app.inject({ method: 'GET', url: '/attachments?noteId=note-1', headers: a });
  assert.deepEqual(list.json().attachments.map((x: { id: string }) => x.id), [meta.id]);

  const file = await app.inject({ method: 'GET', url: `/attachments/${meta.id}`, headers: a });
  assert.equal(file.statusCode, 200);
  assert.equal(file.body, '%PDF-1.4 hello');
  // Never inline, and never sniffed: the mime is client-declared.
  assert.match(file.headers['content-disposition'] as string, /^attachment;/);
  assert.equal(file.headers['x-content-type-options'], 'nosniff');
});

test('an unlisted mime type is refused with 415', async () => {
  const { register, upload } = await fresh();
  const a = await register('pro@example.com');
  for (const mime of ['text/html', 'image/svg+xml', 'application/x-sh']) {
    const res = await upload(a, { mime, filename: 'x' });
    assert.equal(res.statusCode, 415, mime);
  }
});

test('an oversize file is 413 and leaves nothing on disk', async () => {
  const { register, upload, root } = await fresh();
  const a = await register('pro@example.com');

  const res = await upload(a, { bytes: Buffer.alloc(MAX_FILE_BYTES + 1024, 0x41) });
  assert.equal(res.statusCode, 413, res.body);

  // The truncated prefix must be gone — a half-written attachment is worse than none.
  const users = await readdir(root).catch(() => []);
  for (const u of users) {
    assert.deepEqual(await readdir(path.join(root, u)), [], 'a partial file survived');
  }
});

test('the per-note file count is capped', async () => {
  const { register, upload } = await fresh();
  const a = await register('pro@example.com');
  for (let i = 0; i < MAX_PER_NOTE; i++) {
    assert.equal((await upload(a)).statusCode, 200, `upload ${i}`);
  }
  assert.equal((await upload(a)).statusCode, 409);
  // A different note is unaffected — the cap is per note, not per account.
  assert.equal((await upload(a, { noteId: 'note-2' })).statusCode, 200);
});

test('the per-account quota is enforced before the write', async () => {
  const { db, register, upload, root } = await fresh();
  const a = await register('pro@example.com');
  const uid = (db.prepare('SELECT id FROM users WHERE email = ?').get('pro@example.com') as { id: string }).id;

  // Written straight into the table rather than uploaded: the quota is 200 MB and the
  // rule under test is the SUM check, not the ability to move that many bytes.
  db.prepare(`INSERT INTO attachments (id, user_id, note_id, name, mime, size, created_at, updated_at)
              VALUES ('seed', ?, 'note-0', 'big.zip', 'application/zip', ?, 1, 1)`)
    .run(uid, MAX_USER_BYTES);

  const res = await upload(a);
  assert.equal(res.statusCode, 413, res.body);
  assert.match(res.body, /quota/);
  // Refused before the write: nothing was put on disk for this account.
  assert.deepEqual(await readdir(root), []);

  // A tombstoned row frees the space again — the SUM only counts live rows.
  db.prepare("UPDATE attachments SET deleted_at = 2 WHERE id = 'seed'").run();
  assert.equal((await upload(a)).statusCode, 200);
});

test('another account cannot reach the id, and gets 404 rather than 403', async () => {
  const { app, register, upload } = await fresh();
  const a = await register('pro@example.com');
  const b = await register('other@example.com');
  const { id } = (await upload(a)).json();

  // 403 would confirm the id exists. Both routes must be indistinguishable from a typo.
  for (const method of ['GET', 'DELETE'] as const) {
    const res = await app.inject({ method, url: `/attachments/${id}`, headers: b });
    assert.equal(res.statusCode, 404, method);
  }
  // And the owner still has it.
  assert.equal((await app.inject({ method: 'GET', url: `/attachments/${id}`, headers: a })).statusCode, 200);
});

test('a crafted id never reaches the filesystem', async () => {
  const { app, register } = await fresh();
  const a = await register('pro@example.com');
  for (const id of ['../../etc/passwd', '..%2f..%2fetc%2fpasswd', 'a/../../../etc/passwd']) {
    const res = await app.inject({
      method: 'GET', url: `/attachments/${encodeURIComponent(id)}`, headers: a,
    });
    // Refused at the route boundary by the uuid pattern, before any path is built.
    assert.equal(res.statusCode, 400, id);
  }
});

test('deleting tombstones the row, unlinks the bytes, and rides the pull', async () => {
  const { app, db, register, upload, root } = await fresh();
  const a = await register('pro@example.com');
  const { id } = (await upload(a)).json();

  const uid = (db.prepare('SELECT id FROM users WHERE email = ?').get('pro@example.com') as { id: string }).id;
  await stat(path.join(root, uid, id));   // throws if it is not there

  assert.equal((await app.inject({ method: 'DELETE', url: `/attachments/${id}`, headers: a })).statusCode, 200);
  await assert.rejects(stat(path.join(root, uid, id)));
  assert.equal((await app.inject({ method: 'GET', url: `/attachments/${id}`, headers: a })).statusCode, 404);

  const pull = await app.inject({ method: 'GET', url: '/sync/pull?since=0', headers: a });
  const row = pull.json().attachments.find((x: { id: string }) => x.id === id);
  assert.ok(row.deletedAt, 'the tombstone must reach other devices');
});

test('the pull cursor only carries attachments changed after it', async () => {
  const { app, register, upload } = await fresh();
  const a = await register('pro@example.com');
  const { id } = (await upload(a)).json();

  const first = await app.inject({ method: 'GET', url: '/sync/pull?since=0', headers: a });
  assert.equal(first.json().attachments.length, 1);
  const cursor = first.json().serverTime;

  const after = await app.inject({ method: 'GET', url: `/sync/pull?since=${cursor}`, headers: a });
  assert.deepEqual(after.json().attachments, []);

  // The cursor has millisecond resolution, so a write in the same millisecond as the
  // pull it is compared against is genuinely ambiguous — for notes and groups too. The
  // gap is here so this test asserts the cursor, not the clock.
  await new Promise(r => setTimeout(r, 2));
  await app.inject({ method: 'DELETE', url: `/attachments/${id}`, headers: a });
  const withTombstone = await app.inject({ method: 'GET', url: `/sync/pull?since=${cursor}`, headers: a });
  assert.equal(withTombstone.json().attachments.length, 1);
});

test('a missing noteId is refused before anything is stored', async () => {
  const { app, register, root } = await fresh();
  const a = await register('pro@example.com');
  const body = Buffer.from(
    `--${BOUNDARY}\r\n`
    + 'content-disposition: form-data; name="file"; filename="a.pdf"\r\n'
    + 'content-type: application/pdf\r\n\r\nhi\r\n'
    + `--${BOUNDARY}--\r\n`,
  );
  const res = await app.inject({
    method: 'POST', url: '/attachments', headers: { ...a, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: body,
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(await readdir(root), []);
});

test('downloads are not throttled with the credential endpoints', async () => {
  const { app, register, upload } = await fresh();
  const a = await register('pro@example.com');
  const { id } = (await upload(a)).json();

  // The global limit is 10/min per IP and applies to /auth/, /ai/, /admin/ and the
  // upload. A note may hold twenty files, so opening one must not spend that budget.
  for (let i = 0; i < 15; i++) {
    const res = await app.inject({ method: 'GET', url: `/attachments/${id}`, headers: a });
    assert.equal(res.statusCode, 200, `download ${i} answered ${res.statusCode}`);
  }
});
