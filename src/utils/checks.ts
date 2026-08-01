/**
 * Runnable self-checks for the two pieces of non-trivial logic in the data path:
 * the v1→v2 note-label migration and markdown escaping.
 *
 *   node --experimental-strip-types src/utils/checks.ts
 *
 * No framework on purpose — this is the smallest thing that fails if either breaks.
 */
import assert from 'node:assert/strict';
import { migrateColor, migrateNotes, toWire, NOTE_COLORS } from '../types/note.ts';
import type { Note } from '../types/note.ts';
import { renderMarkdown } from './markdown.ts';
import { detectDirection } from './direction.ts';
import { clearPushed, mergeNotes } from './merge.ts';

// ── Note label migration (PLAN-V2 Phase 1.3) ────────────────────────
assert.equal(migrateColor('yellow'), 'sand');
assert.equal(migrateColor('blue'), 'sky');
assert.equal(migrateColor('green'), 'sage');
assert.equal(migrateColor('pink'), 'rose');
assert.equal(migrateColor('purple'), 'lilac');

// Already-migrated values survive a second read
for (const c of NOTE_COLORS) assert.equal(migrateColor(c), c);

// Anything unrecognised degrades to "no label", never throws
assert.equal(migrateColor(null), null);
assert.equal(migrateColor(undefined), null);
assert.equal(migrateColor('chartreuse'), null);
assert.equal(migrateColor(42), null);

// Migration touches only `color` — the rest of the note is untouched
const legacy = {
  id: 'a', title: 't', body: 'b',
  createdAt: 1, updatedAt: 2, color: 'yellow', pinned: true, deletedAt: null,
} as unknown as Note;
// A v1 note also picks up the sync fields, starting dirty so it gets pushed once.
assert.deepEqual(migrateNotes([legacy]), [{ ...legacy, color: 'sand', dirty: true, syncedAt: null }]);

// ── Markdown escaping (PLAN-V2 Phase 6) ─────────────────────────────
// Output goes into dangerouslySetInnerHTML, so no user markup may survive.
const xss = renderMarkdown('<img src=x onerror=alert(1)>');
assert.ok(!xss.includes('<img'), 'raw tag leaked through renderInline');
assert.ok(xss.includes('&lt;img'), 'tag was not escaped');

assert.ok(
  !renderMarkdown('**<script>alert(1)</script>**').includes('<script'),
  'tag leaked through a bold span',
);

// javascript: and data: hrefs are neutralised; ordinary links keep working
assert.ok(
  renderMarkdown('[x](javascript:alert(1))').includes('href="#"'),
  'javascript: href was not blocked',
);
assert.ok(
  renderMarkdown('[x](data:text/html,<script>alert(1)</script>)').includes('href="#"'),
  'data: href was not blocked',
);
assert.ok(
  renderMarkdown('[x](https://example.com)').includes('href="https://example.com"'),
  'a normal link should survive',
);

// Attribute breakout through the link label or URL
assert.ok(
  !renderMarkdown('[x]("onmouseover="alert(1))').includes('onmouseover='),
  'quote in a URL allowed an attribute breakout',
);

// Protocol-relative URLs look internal but leave the origin
assert.ok(
  renderMarkdown('[x](//evil.com)').includes('href="#"'),
  'protocol-relative URL was not blocked',
);
assert.ok(
  renderMarkdown('[x](/notes/1)').includes('href="/notes/1"'),
  'a real root-relative link should survive',
);

// A pathological line degrades to escaped plain text instead of freezing the tab
const huge = renderMarkdown(`${'*'.repeat(20_000)}<b>x</b>`);
assert.ok(!huge.includes('<b>'), 'the inline ceiling must still escape');
assert.ok(huge.includes('&lt;b&gt;'), 'text past the ceiling must still be rendered');

// Fenced code blocks stay escaped (v1 behaviour, guarded against regression)
assert.ok(
  renderMarkdown('```\n<b>hi</b>\n```').includes('&lt;b&gt;'),
  'code block stopped escaping',
);

// ── Direction detection ─────────────────────────────────────────────
assert.equal(detectDirection('سلام'), 'rtl');
assert.equal(detectDirection('hello'), 'ltr');
assert.equal(detectDirection(''), 'rtl', 'empty text defaults to rtl');
assert.equal(detectDirection('۱۲۳ !@#'), 'rtl', 'digits/punctuation are not strong');
assert.equal(detectDirection('123 hello سلام'), 'ltr', 'first strong char wins');
assert.equal(detectDirection('سلام hello'), 'rtl', 'first strong char wins');

// ── Sync merge (PLAN-V2 Phase 5.4) ──────────────────────────────────
// The risky path: a background pull must never eat a local edit.
function note(over: Partial<Note> = {}): Note {
  return {
    id: 'n', title: '', body: '', createdAt: 0, updatedAt: 100,
    color: null, pinned: false, deletedAt: null, dirty: false, syncedAt: null,
    ...over,
  };
}
const wire = (over: Partial<Note> = {}) => toWire(note(over));

// Remote strictly newer wins, and the merged copy is no longer dirty
const remoteWins = mergeNotes([note({ body: 'old' })], [wire({ body: 'new', updatedAt: 200 })], 500);
assert.equal(remoteWins[0].body, 'new');
assert.equal(remoteWins[0].dirty, false);
assert.equal(remoteWins[0].syncedAt, 500);

// Local newer, or the same age, is kept — equal timestamps are not a conflict
assert.equal(mergeNotes([note({ body: 'mine', updatedAt: 300 })], [wire({ body: 'theirs' })], 1)[0].body, 'mine');
assert.equal(mergeNotes([note({ body: 'mine' })], [wire({ body: 'theirs' })], 1)[0].body, 'mine');

// An unknown remote note is added
assert.equal(mergeNotes([], [wire({ id: 'x' })], 1).length, 1);

// A tombstone is just a newer update, so a delete beats an older edit
assert.ok(mergeNotes([note()], [wire({ updatedAt: 200, deletedAt: 200 })], 1)[0].deletedAt);

// THE ONE THAT MATTERS: a note with unpushed edits is never clobbered, however much
// newer the remote copy claims to be.
const typing = mergeNotes(
  [note({ id: 'open', body: 'typing…', dirty: true })],
  [wire({ id: 'open', body: 'remote', updatedAt: 999 })],
  1,
);
assert.equal(typing[0].body, 'typing…', 'a pull overwrote a note with unpushed edits');
assert.equal(typing[0].dirty, true, 'the protected note must stay queued for the next push');

// Same protection after switching away from it — "dirty", not "open", is the rule
const parked = mergeNotes(
  [note({ id: 'other', dirty: true }), note({ id: 'open' })],
  [wire({ id: 'other', body: 'remote', updatedAt: 999 })],
  1,
);
assert.equal(parked[0].body, '', 'a backgrounded dirty note lost its edits');

// Clean: nothing local to lose, so the remote copy wins
assert.equal(
  mergeNotes([note({ id: 'open' })], [wire({ id: 'open', body: 'remote', updatedAt: 999 })], 1)[0].body,
  'remote',
);

// ── Clearing the dirty flag after a push ────────────────────────────
// Accepted and untouched since the push → clean
assert.equal(clearPushed([note({ dirty: true })], [{ id: 'n', updatedAt: 100 }], 7)[0].dirty, false);
// Edited while the request was in flight → still dirty, goes out next round
assert.equal(clearPushed([note({ dirty: true, updatedAt: 150 })], [{ id: 'n', updatedAt: 100 }], 7)[0].dirty, true);
// Rejected by the server (absent from `pushed`) → still dirty
assert.equal(clearPushed([note({ dirty: true })], [], 7)[0].dirty, true);

console.log('checks passed');
