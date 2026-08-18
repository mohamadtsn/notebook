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
import { detectDirection } from './direction.ts';
import { cacheKey, evict, type AiCacheEntry } from './aiCache.ts';
import { buildMessages } from './ai.ts';
import {
  emptyHistory, record, undo, redo, evictHistories, COALESCE_MS, MAX_ENTRIES,
  type NoteHistory,
} from './history.ts';
import { JSDOM } from 'jsdom';

// renderMarkdown sanitises with DOMPurify, which needs a real DOM. Installing one here
// means these assertions exercise the pipeline that actually ships, not a stub.
(globalThis as { window?: unknown }).window = new JSDOM('').window;
const { renderMarkdown } = await import('./markdown.ts');
import { clearPushed, mergeById, mergeNotes } from './merge.ts';
import { DEFAULT_SETTINGS, migrateSettings, toWireSettings } from '../types/settings.ts';
import { toWireGroup, orderBetween } from '../types/group.ts';
import type { Group } from '../types/group.ts';

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
assert.deepEqual(migrateNotes([legacy]), [
  { ...legacy, color: 'sand', groupId: null, dirty: true, syncedAt: null },
]);

// ── Markdown rendering + sanitising ─────────────────────────────────
// Output goes into dangerouslySetInnerHTML. Two layers guard it: markdown-it runs with
// `html: false`, and DOMPurify strips whatever the parser might still emit.
const xss = renderMarkdown('<img src=x onerror=alert(1)>');
assert.ok(!xss.includes('<img'), 'raw tag leaked into the preview');
// It appears in the output as escaped TEXT, which is correct; what must never exist
// is an element carrying it as an attribute.
assert.ok(!/<[^>]*onerror/i.test(xss), 'event handler leaked in as an attribute');
assert.ok(xss.includes('&lt;img'), 'the raw tag must still be shown as text');

assert.ok(
  !renderMarkdown('**<script>alert(1)</script>**').includes('<script'),
  'tag leaked through a bold span',
);

// javascript: and data: hrefs never become a usable link.
assert.ok(
  !/href="javascript:/i.test(renderMarkdown('[x](javascript:alert(1))')),
  'javascript: href was not blocked',
);
assert.ok(
  !/href="data:/i.test(renderMarkdown('[x](data:text/html,<script>alert(1)</script>)')),
  'data: href was not blocked',
);
assert.ok(
  renderMarkdown('[x](https://example.com)').includes('href="https://example.com"'),
  'a normal link should survive',
);
assert.ok(
  renderMarkdown('[x](https://example.com)').includes('rel="noopener noreferrer nofollow"'),
  'an external link must be severed from this document',
);
assert.ok(
  renderMarkdown('[x](/notes/1)').includes('href="/notes/1"'),
  'a real root-relative link should survive',
);

// Attribute breakout through the link label or URL
assert.ok(
  !renderMarkdown('[x]("onmouseover="alert(1))').includes('onmouseover='),
  'quote in a URL allowed an attribute breakout',
);

// Images stay unsupported: they need onerror handling and they let a previewed note
// call out to a third-party host.
assert.ok(!renderMarkdown('![alt](https://example.com/a.png)').includes('<img'), 'images are not supported');

// Fenced code blocks are escaped, not parsed.
assert.ok(
  renderMarkdown('```\n<b>hi</b>\n```').includes('&lt;b&gt;'),
  'code block stopped escaping',
);

// The renderer must not choke on pathological input — the preview re-renders on
// every keystroke, so a freeze here is a frozen tab.
const t0 = Date.now();
const huge = renderMarkdown(`${'*'.repeat(20_000)}<b>x</b>`);
assert.ok(!huge.includes('<b>'), 'pathological input must still be escaped');
assert.ok(Date.now() - t0 < 1000, 'renderer took too long on pathological input');

// Things the hand-rolled renderer could not do, which is why it was replaced.
assert.ok(renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |').includes('<table>'), 'tables');
assert.ok(renderMarkdown('> quoted').includes('<blockquote>'), 'blockquotes');
assert.ok(renderMarkdown('1. one\n2. two').includes('<ol>'), 'ordered lists');
assert.ok(renderMarkdown('- [ ] todo').includes('<li>'), 'nested list markers');
assert.ok(renderMarkdown('a\nb').includes('<br>'), 'a single newline is a line break');

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
    color: null, pinned: false, deletedAt: null, groupId: null, dirty: false, syncedAt: null,
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

// ── Settings migration (v3 Phase 0.2) ───────────────────────────────
// Nothing stored yet → every field comes from the defaults.
assert.deepEqual(migrateSettings(undefined), DEFAULT_SETTINGS);
assert.deepEqual(migrateSettings(null), DEFAULT_SETTINGS);
assert.deepEqual(migrateSettings('garbage'), DEFAULT_SETTINGS);
assert.deepEqual(migrateSettings(42), DEFAULT_SETTINGS);

// A partial object from an older build fills the gaps instead of producing undefined.
const partial = migrateSettings({ theme: 'dark' });
assert.equal(partial.theme, 'dark');
assert.equal(partial.syncIntervalMs, DEFAULT_SETTINGS.syncIntervalMs);
assert.equal(partial.ai.mode, DEFAULT_SETTINGS.ai.mode);
assert.equal(partial.experimentalEditor, false);
assert.equal(partial.version, DEFAULT_SETTINGS.version);

// A partial `ai` sub-object is filled per field, not replaced wholesale.
const partialAi = migrateSettings({ ai: { model: 'custom-model' } });
assert.equal(partialAi.ai.model, 'custom-model');
assert.equal(partialAi.ai.targetLang, DEFAULT_SETTINGS.ai.targetLang);
assert.equal(partialAi.ai.cache, true);

// Unknown keys are dropped — a stale field must never reach the server.
assert.ok(!('legacyFlag' in migrateSettings({ legacyFlag: true } as object)));

// Wrong types degrade to the default rather than throwing.
assert.equal(migrateSettings({ theme: 'neon' }).theme, DEFAULT_SETTINGS.theme);
assert.equal(migrateSettings({ syncIntervalMs: 'fast' }).syncIntervalMs, DEFAULT_SETTINGS.syncIntervalMs);
// null is a *valid* interval (manual only), so it must survive.
assert.equal(migrateSettings({ syncIntervalMs: null }).syncIntervalMs, null);

// THE ONE THAT MATTERS: the provider key is a device credential and never goes to the server.
const wired = toWireSettings({ ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, apiKey: 'sk-secret' } });
assert.ok(!('apiKey' in wired.ai), 'the AI key leaked into the wire shape');
assert.ok(!JSON.stringify(wired).includes('sk-secret'), 'the AI key leaked into the serialised payload');
assert.ok(!('dirty' in wired), 'local-only sync bookkeeping leaked into the wire shape');

// ── Generic merge over a second entity (v3 Phase 2.2) ────────────────
// The exact same rules must hold for a record that is not a Note. If this section
// ever needs its own logic, the generalisation failed and should be reverted.
interface Fake { id: string; updatedAt: number; dirty: boolean; syncedAt: number | null; name: string }
const fake = (over: Partial<Fake> = {}): Fake =>
  ({ id: 'g', updatedAt: 100, dirty: false, syncedAt: null, name: 'a', ...over });
const fakeWire = (over: Partial<Fake> = {}) => {
  const full = fake(over);
  return { id: full.id, updatedAt: full.updatedAt, name: full.name };
};

assert.equal(mergeById([fake()], [fakeWire({ name: 'b', updatedAt: 200 })], 5)[0].name, 'b');
assert.equal(mergeById([fake()], [fakeWire({ name: 'b', updatedAt: 200 })], 5)[0].syncedAt, 5);
assert.equal(mergeById([fake({ updatedAt: 300 })], [fakeWire({ name: 'b' })], 5)[0].name, 'a');
assert.equal(mergeById<Fake>([], [fakeWire({ id: 'new' })], 5).length, 1);
// THE ONE THAT MATTERS, again: unpushed local edits survive a pull.
const dirtyGroup = mergeById([fake({ dirty: true, name: 'mine' })], [fakeWire({ name: 'theirs', updatedAt: 999 })], 5);
assert.equal(dirtyGroup[0].name, 'mine', 'a pull overwrote a group with unpushed edits');
assert.equal(dirtyGroup[0].dirty, true, 'the protected group must stay queued');

// ── Group model (v3 Phase 2.1) ──────────────────────────────────────
// A note stored before groups existed has no groupId; it must read as "no group",
// never as undefined — an undefined here would break every `=== null` filter.
const preGroup = { ...legacy, color: 'yellow' } as unknown as Note;
assert.equal(migrateNotes([preGroup])[0].groupId, null);

// groupId travels on the wire — without this the server never learns about the move.
assert.ok('groupId' in toWire(note({ groupId: 'g1' })));
assert.equal(toWire(note({ groupId: 'g1' })).groupId, 'g1');

// Sparse ordering: inserting between two groups takes the midpoint, so a reorder
// writes ONE row instead of renumbering the whole list.
assert.equal(orderBetween(1, 2), 1.5);
assert.equal(orderBetween(null, 2), 1);      // first slot
assert.equal(orderBetween(1, null), 2);      // last slot
assert.equal(orderBetween(null, null), 1);   // empty list
// Repeated midpoints must stay strictly between their neighbours.
const mid = orderBetween(1, 1.5);
assert.ok(mid > 1 && mid < 1.5, 'midpoint escaped its neighbours');

// Group wire shape drops local-only bookkeeping, same rule as notes.
const g: Group = {
  id: 'g1', name: 'کار', color: 'sky', order: 1,
  createdAt: 1, updatedAt: 2, deletedAt: null, dirty: true, syncedAt: null,
};
assert.ok(!('dirty' in toWireGroup(g)));
assert.ok(!('syncedAt' in toWireGroup(g)));
assert.equal(toWireGroup(g).name, 'کار');

// ── Persistent edit history ─────────────────────────────────────────
const e = (value: string, at = 0) => ({ value, start: at, end: at });
let h: NoteHistory = emptyHistory(e('a'), 0);

// A selection move is not an edit; recording the same value must not create a step.
assert.equal(record(h, e('a', 1), 10_000), h, 'an unchanged value became an undo step');

// Steps far apart in time are separate; undo walks back one at a time.
h = record(h, e('ab'), 10_000);
h = record(h, e('abc'), 20_000);
assert.equal(h.entries.length, 3);
const back = undo(h);
assert.ok(back);
assert.equal(back.entry.value, 'ab');
assert.equal(undo(back.history)?.entry.value, 'a');

// Redo returns exactly what undo took away.
assert.equal(redo(back.history)?.entry.value, 'abc');
// ...and there is nothing to redo from the newest state.
assert.equal(redo(h), null);
assert.equal(undo(emptyHistory(e('a'), 0)), null);

// Keystrokes inside the coalesce window collapse into ONE step, so undo moves by
// words rather than by characters.
let fast: NoteHistory = emptyHistory(e('a'), 0);
fast = record(fast, e('ab'), 10_000);
fast = record(fast, e('abc'), 10_000 + COALESCE_MS - 1);
fast = record(fast, e('abcd'), 10_000 + COALESCE_MS - 1);
assert.equal(fast.entries.length, 2, 'fast keystrokes must collapse into one step');
assert.equal(undo(fast)?.entry.value, 'a');

// A discrete step (cut, paste, an AI replacement) never merges into the words typed
// just before it — one Ctrl+Z must not throw away both.
let mixed: NoteHistory = emptyHistory(e('a'), 0);
mixed = record(mixed, e('ab'), 10_000);
mixed = record(mixed, e('ab CUT'), 10_100, true);
assert.equal(mixed.entries.length, 3, 'a discrete step was coalesced into typing');
assert.equal(undo(mixed)?.entry.value, 'ab', 'undo must return the pre-edit text');

// Editing after an undo drops the redo tail — same as every editor.
const branched = record(undo(h)!.history, e('abX'), 40_000);
assert.equal(redo(branched), null, 'a stale redo survived a new edit');
assert.equal(branched.entries.map(x => x.value).join(','), 'a,ab,abX');

// The per-note cap trims the OLD end: the newest states are the reachable ones.
let long: NoteHistory = emptyHistory(e('0'), 0);
for (let i = 1; i < MAX_ENTRIES + 20; i++) long = record(long, e(String(i)), i * 10_000);
assert.equal(long.entries.length, MAX_ENTRIES, 'the per-note cap was not enforced');
assert.equal(long.entries.at(-1)?.value, String(MAX_ENTRIES + 19));
assert.equal(long.index, MAX_ENTRIES - 1, 'the cursor must follow the trim');

// Store eviction drops whole notes, least-recently-touched first. Half a history is
// worse than none — undo would stop somewhere the user did not expect.
const fatEntry = (n: number): NoteHistory =>
  ({ entries: [e('x'.repeat(400_000))], index: 0, updatedAt: n });
const evicted = evictHistories({ old: fatEntry(1), recent: fatEntry(2) });
assert.deepEqual(Object.keys(evicted), ['recent'], 'eviction kept the wrong note');
const smallStore = { a: emptyHistory(e('a'), 1) };
assert.deepEqual(evictHistories(smallStore), smallStore);

// -- AI response cache ----------------------------------------------
// The key must be collision-resistant: a collision here serves one note's translation
// for another's, which is data corruption, not a cache miss. Hence SHA-256.
const k1 = await cacheKey({ task: 'translate', model: 'm', targetLang: 'fa', text: 'hello' });
assert.equal(k1, await cacheKey({ task: 'translate', model: 'm', targetLang: 'fa', text: 'hello' }));
assert.equal(k1.length, 64, 'expected a hex SHA-256');

// Every input participates: changing any one of them must miss.
assert.notEqual(k1, await cacheKey({ task: 'improve',   model: 'm',  targetLang: 'fa', text: 'hello' }));
assert.notEqual(k1, await cacheKey({ task: 'translate', model: 'm2', targetLang: 'fa', text: 'hello' }));
assert.notEqual(k1, await cacheKey({ task: 'translate', model: 'm',  targetLang: 'en', text: 'hello' }));
assert.notEqual(k1, await cacheKey({ task: 'translate', model: 'm',  targetLang: 'fa', text: 'hello!' }));

// Field boundaries must not be ambiguous: "ab"+"c" and "a"+"bc" are different requests.
assert.notEqual(
  await cacheKey({ task: 'translate', model: 'ab', targetLang: 'c', text: 'x' }),
  await cacheKey({ task: 'translate', model: 'a', targetLang: 'bc', text: 'x' }),
);
// ...including when a field legitimately contains a space, as model names do.
assert.notEqual(
  await cacheKey({ task: 'translate', model: 'a b', targetLang: 'c', text: 'x' }),
  await cacheKey({ task: 'translate', model: 'a', targetLang: 'b c', text: 'x' }),
);

// Eviction: the entry cap is enforced, least-recently-used goes first.
const cacheEntry = (key: string, lastUsedAt: number, size = 10): AiCacheEntry =>
  ({ key, result: 'r'.repeat(size), createdAt: 0, lastUsedAt });
const kept = evict(Array.from({ length: 60 }, (_, i) => cacheEntry(`k${i}`, i)));
assert.equal(kept.length, 50, 'the entry cap was not enforced');
assert.ok(!kept.some(x => x.key === 'k0'), 'the least-recently-used entry survived');
assert.ok(kept.some(x => x.key === 'k59'), 'the most-recently-used entry was evicted');

// Eviction: the byte cap is enforced even when the entry count is legal.
const trimmedCache = evict([cacheEntry('a', 1, 200_000), cacheEntry('b', 2, 200_000)]);
assert.equal(trimmedCache.length, 1, 'the byte cap was not enforced');
assert.equal(trimmedCache[0].key, 'b', 'the byte cap evicted the wrong end');

// An already-legal cache is returned unchanged.
const smallCache = [cacheEntry('a', 1), cacheEntry('b', 2)];
assert.deepEqual(evict(smallCache), smallCache);

// -- AI prompt building ---------------------------------------------
// One builder for both transports: proxy and direct must produce identical output, or
// the same request cached in one mode would be wrong in the other.
const improve = buildMessages('improve', 'یک متن', 'fa');
assert.equal(improve.length, 2);
assert.equal(improve[0].role, 'system');
assert.equal(improve[1].role, 'user');
assert.equal(improve[1].content, 'یک متن', 'the user text must reach the prompt verbatim');

const translate = buildMessages('translate', 'hello', 'fa');
assert.ok(translate[0].content.includes('fa'), 'the target language must reach the system prompt');
assert.notEqual(
  buildMessages('translate', 'hello', 'en')[0].content,
  translate[0].content,
  'the target language must change the prompt',
);
// The note text is never spliced into the system prompt: that is the jailbreak surface.
assert.ok(!buildMessages('translate', 'IGNORE ALL', 'fa')[0].content.includes('IGNORE ALL'));

console.log('checks passed');
