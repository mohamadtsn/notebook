# Notebook v3 — Design Spec

Date: 2026-08-17
Status: approved for planning

Written in English to match `DESIGN.md` / `PRODUCT.md` / `CLAUDE.md`. All user-facing strings
specified here are Persian, per the existing product.

## 1. Scope

Six phases, each independently shippable and independently revertible:

| Phase | Delivers |
| --- | --- |
| 0 | Editor focus bug fixed at its root; `useSettings` foundation |
| 1 | Settings panel; sync interval becomes configurable |
| 2 | Groups (single-level folders) — local model, server schema, sync, drag/menu/palette UX |
| 3 | Editor context menu |
| 4 | AI actions (improve-as-prompt, translate) with a response cache |
| 5 | CodeMirror 6 multi-cursor behind an experimental gate |

Explicitly out of scope: nested groups, real-time multi-device sync, token streaming for AI,
a second animation library (`motion` v12 is already the motion system — GSAP is not added).

## 2. Standing constraints

Every phase below inherits these; they are not restated per phase.

- **Local-first.** No feature may require an account to be usable. Where an account is genuinely
  required (server AI proxy, settings sync), the UI stays reachable and shows a sign-in CTA rather
  than a locked state. — `PRODUCT.md` principle 1.
- **`DESIGN.md` is closed before code opens.** Any component this spec introduces that `DESIGN.md`
  does not already specify (settings overlay, context menu, group chip, drop affordance, AI result
  popover) gets its section written into `DESIGN.md` first. — `CLAUDE.md`.
- **Logical CSS only.** A physical `left`/`right` is a bug.
- **Accessibility floor** (`DESIGN.md` §8) is a per-phase gate, not a follow-up: keyboard path,
  visible focus, `aria-label` on icon-only controls, ≥44px targets, contrast, reduced-motion.
- **Persistence stays out of components.** New state follows the `useNotes` shape exactly:
  `setX(prev => { const updated = …; persist(updated); return updated; })`, synchronous, no save
  effect.
- **`src/utils/checks.ts` grows with the logic.** Any new pure rule (merge, migration, cache
  eviction, prompt building) lands with assertions there; `npm run check` is a per-phase gate.

---

## Phase 0 — Focus bug + settings foundation

### 0.1 The focus bug — root cause

`Editor.tsx:112` attaches `onMouseDown` to the outer `motion.div` with an
`e.target === e.currentTarget` guard. That element is not the one the user clicks. The textarea's
height is driven to `scrollHeight` (`Editor.tsx:86-94`), so on any note shorter than the pane the
large empty region below the text belongs to the **scroll container** at `Editor.tsx:143`
(`pt-18 pb-10`), which has no handler. The event stops there and focus never moves.

Fix, in one place:

- Move the handler to the scroll container (`Editor.tsx:143`), keeping the
  `e.target === e.currentTarget` guard so a click landing on the title, the textarea, the trash
  banner, or the toolbar is untouched.
- On focus, place the caret at the end of the body (`el.setSelectionRange(len, len)`), not at
  index 0 — clicking below a document means "keep writing", not "jump to the top".
- No-op when `isTrash` (fields are disabled) or when `mode === 'preview'` (there is no textarea).
- Keep the existing outer handler as well: the gutter margins of the card are still a legitimate
  click-to-write target.

Verified by: manual — click the empty space below a one-line note, in both `write` and `preview`
mode, in trash and out of it.

### 0.2 `useSettings`

New hook `src/hooks/useSettings.ts`, storage key `notebook_settings`, same shape as `useNotes`.

```ts
export interface Settings {
  version: 3;
  theme: 'light' | 'dark' | 'system';
  /** null = manual + event triggers only, no timer. */
  syncIntervalMs: number | null;
  ai: {
    mode: 'proxy' | 'direct';
    baseUrl: string;          // OpenAI-compatible, direct mode only
    model: string;
    apiKey: string | null;    // direct mode only; NEVER leaves the device
    targetLang: string;       // ISO code, default 'fa'
    cache: boolean;           // default true
  };
  experimentalEditor: boolean;
  updatedAt: number;
  dirty: boolean;
}
```

- `migrateSettings(raw)` fills every missing field from `DEFAULT_SETTINGS` and stamps `version`,
  mirroring `migrateNotes` — a stored object from an older build must never produce `undefined`
  at a read site.
- `useDarkMode` stays the writer of `notebook_dark` in this phase; Phase 1 folds it in and adopts
  the stored boolean once as `theme: 'light' | 'dark'`. Splitting it keeps the Phase 0 diff to the
  bug fix plus one new file.

**Gate:** `npm run check` covers `migrateSettings` (missing field → default, unknown field
dropped, an older `version` upgraded without loss).

---

## Phase 1 — Settings panel

### 1.1 Surface

A centered modal overlay using the `overlay` glass material (`DESIGN.md` §2) over the mandatory
scrim. Opened from three places: a gear `IconButton` in `Navbar`, a `⌘K` palette action
(«تنظیمات»), and `⌘,`. **No enter animation on the keyboard paths** (`DESIGN.md` §5 — keyboard
actions are instant); the Navbar click gets the standard 200ms `--ease-out` scale-from-.96 enter.
`Esc` and scrim click close it.

Layout: a section list, not tabs — four sections is under the count that earns tab chrome.

### 1.2 Sections

| Section | Contents |
| --- | --- |
| ظاهر | theme segmented control: روشن / تیره / سیستم |
| همگام‌سازی | account row (email + sign in/out), sync interval, manual sync button, pending-count |
| هوش مصنوعی | mode, provider fields, target language, cache toggle + clear-cache (Phase 4) |
| درباره | version, storage usage, link to source |

Signed out, the همگام‌سازی section renders the sign-in CTA in place of the interval control and
the AI section shows only the direct-mode fields. Nothing is disabled-and-greyed; the section
explains what an account adds.

### 1.3 Sync interval

`INTERVAL_MS` (`useSync.ts:10`) becomes an option on `useSync`, fed from settings. Choices:
خاموش · ۱ · ۵ · ۱۵ · ۶۰ دقیقه. Default 60s (today's behaviour, unchanged for existing users).

`null` (خاموش) clears the timer only. The `focus` / `online` / manual triggers stay registered in
every case — they cost nothing, they are what makes sync feel instant, and removing them would
turn "off the timer" into "sync is broken".

The effect in `useSync.ts:74` gains `intervalMs` in its dependency array; the ref pattern for
`notes`/`token` is untouched, so changing the interval re-registers the timer and nothing else.

### 1.4 Settings sync

Settings are local always, and mirrored to the server while signed in.

- Server: `settings` table, one row per user — `user_id TEXT PRIMARY KEY`, `json TEXT NOT NULL`,
  `updated_at INTEGER NOT NULL`.
- Routes: `GET /settings` → `{ settings, updatedAt } | null`, `PUT /settings` → last-write-wins on
  `updatedAt`, returning the winner so the client can adopt it.
- Transport: one extra step at the end of the existing `sync()` cycle in `useSync.ts`, after the
  note pull. A settings failure must **not** mark the note sync as failed — notes are the data,
  settings are a preference; the states are reported separately.
- Conflict rule: whole-object last-write-wins on `updatedAt`. Per-field merge is not worth its
  complexity for a preferences blob.
- **`ai.apiKey` is stripped by `toWireSettings` and never sent.** A provider key is a device
  credential, not a preference; syncing it would copy a secret onto every device and into the
  database for no benefit. Same reason `toWire` in `types/note.ts` lists fields explicitly —
  add new fields there, never by spreading.

**Gate:** `npm run check` for `toWireSettings` (asserts `apiKey` absent) and the LWW rule;
`cd server && npm test` for the settings routes including cross-user isolation.

---

## Phase 2 — Groups

The largest phase. Ships in three reviewable steps: model → server → UX.

### 2.1 Model

```ts
export interface Group {
  id: string;
  name: string;
  color: NoteColor | null;
  /** Sparse float. Inserting between two groups takes their midpoint — no reindex write storm. */
  order: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  dirty: boolean;
  syncedAt: number | null;
}
```

`Note` gains `groupId: string | null`. `null` means «بدون گروه» — a real, always-present bucket,
not an error state. `migrateNotes` fills `groupId ?? null`.

`useGroups` (`src/hooks/useGroups.ts`), storage key `notebook_groups`, identical shape to
`useNotes`: synchronous persist inside the updater, soft delete via `deletedAt`, `patchGroup`
stamping `dirty: true`.

### 2.2 Generic merge

`mergeNotes` and `clearPushed` (`src/utils/merge.ts`) are generalised rather than duplicated:

```ts
interface Syncable { id: string; updatedAt: number; dirty: boolean }
export function mergeById<T extends Syncable>(local: T[], remote: …, syncedAt: number): T[]
```

The rules are unchanged and remain the risk surface: last-write-wins on `updatedAt`, **a note or
group still marked `dirty` is never replaced**, tombstones are ordinary updates. `mergeNotes` stays
as a thin typed alias so existing call sites and the existing assertions in `checks.ts` keep
working; the new group path calls the same function. One implementation, two entities.

### 2.3 Server

`server/src/db.ts`:

```sql
CREATE TABLE IF NOT EXISTS groups (
  id         TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id),
  name       TEXT NOT NULL,
  color      TEXT,
  sort_order REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS groups_user_updated ON groups(user_id, updated_at);
```

`notes` gains `group_id TEXT`. SQLite has no `ADD COLUMN IF NOT EXISTS`, so the migration reads
`PRAGMA table_info(notes)` and issues the `ALTER TABLE` only when the column is absent —
idempotent, so a container restart on an existing `./data` file is safe. The bind-mounted DB
(`./data`, deliberately not a docker volume) is never recreated; migration correctness is the only
thing standing between a deploy and data loss, so it gets its own test.

`server/src/sync.ts`:

- `noteSchema` gains `groupId: { type: ['string','null'], maxLength: 64 }`. It is
  `additionalProperties: false`, so **without this the whole push is rejected** — this line and the
  client field must ship in the same commit.
- `/sync/push` body becomes `{ notes: [...], groups?: [...] }`; `/sync/pull` returns
  `{ notes, groups, serverTime }`. `groups` optional on push and defaulted to `[]` on pull keeps an
  older client working against a newer server.
- Every group statement filters on the token's `user_id`, exactly as the note statements do
  (`sync.ts:61-72`). Never on client input. A cross-user id matches nothing.
- No foreign key from `notes.group_id` to `groups.id`: sync delivers rows in arbitrary order and a
  constraint would reject a note that arrives before its group. Referential integrity is resolved
  on read (unknown `groupId` renders as «بدون گروه»), which is also what makes a group deletion
  racing a note edit harmless.

**Gate:** `cd server && npm test` — migration is idempotent, migration preserves existing rows,
group push/pull round-trips, user B cannot read or overwrite user A's group by id.

### 2.4 UX

The stated requirement is that this must not make the app harder to use. Concretely:

**Sidebar.** A groups strip above the note list, inside the same single scroll container
(`Sidebar.tsx:69` — one scroll container per region, `DESIGN.md` §2). «همه» is pinned first and is
the default. Each row: name, note count, and the group's 3px inline-start colour bar reusing the
`NoteItem` label treatment. Selecting a group filters the list; the sort control and the pinned-first
rule keep working within the filter.

**Moving a note — four paths, because drag alone fails two audiences.**

1. **Drag** (desktop, `@media (hover: hover) and (pointer: fine)`): the `NoteItem` row becomes a
   `motion.div` with `drag`, `dragSnapToOrigin`, and the `springDrag` config already in
   `src/lib/motion.ts`. Drop targets are hit-tested against the group rows' bounding boxes on
   `onDrag`; the hovered group gets the `--accent-soft` fill already used for the active row.
   Release outside a target springs the row home. Disabled on touch — it would fight the sheet's
   own `drag="x"` dismissal (`App.tsx:151-160`).
2. **Context menu** on the note row → «انتقال به گروه» → submenu. Works on touch via long-press.
3. **Command palette** action «انتقال به گروه…».
4. **Editor toolbar** overflow menu, for the note you are currently in.

Paths 2–4 give the full keyboard route the accessibility floor requires; drag is an accelerator,
never the only door.

**Group CRUD.** Create from a `+` at the end of the strip, which inserts an inline text field
already focused — no dialog. Rename inline on double-click or via the row's menu. Reorder by
dragging a group row (midpoint `order`).

**Deleting a group never deletes notes.** Its notes fall back to `groupId: null` and the action
raises an undo toast (`DESIGN.md` §6 — undo over confirm), matching `handleTrash` in `App.tsx:74`.
Undo restores both the group and the affected notes' `groupId`, so the undo must capture the
previous assignment before the write.

**Gate:** `npm run check` for the group merge rules and the group-delete reassignment; manual
run of the §8 checklist at 375/768/1024/1440.

---

## Phase 3 — Editor context menu

Built on the existing `src/components/ui/Popover.tsx`, anchored to the pointer coordinates,
scaling from that origin (`DESIGN.md` §5). Opens on `contextmenu` inside the editor sheet, and on
`Shift+F10` / the Menu key anchored to the caret — a menu reachable only by right-click is not a
keyboard path.

Items:

- برش · کپی · چسباندن — via the async Clipboard API, each hidden when unavailable rather than
  shown broken.
- قالب‌بندی — wraps the current selection in markdown: بولد `**`, ایتالیک `*`, کد `` ` ``, لینک
  `[…](…)`. Implemented as one `wrapSelection(value, start, end, before, after)` pure function so
  the rule is testable and the toolbar can reuse it later.
- انتقال به گروه — the Phase 2 submenu.
- (Phase 4 inserts the هوش مصنوعی submenu here.)

**`Shift`+right-click passes through to the browser's native menu.** Persian spellcheck
suggestions live there and losing them would be a regression, so the escape hatch is deliberate
and documented in the menu itself.

Every mutation goes through the existing `onUpdate` path, so the 500ms debounce, the `dirty` stamp,
and undo all keep working — the menu never writes storage directly.

**Gate:** `npm run check` for `wrapSelection` (empty selection, selection at string edges, nested
markers, RTL text).

---

## Phase 4 — AI actions

### 4.1 Two tasks

Both operate on the current selection in the editor body, from the context menu's هوش مصنوعی
submenu:

1. **بهبود به عنوان prompt** — rewrite the selection as a well-formed prompt.
2. **ترجمه** — translate to `settings.ai.targetLang`.

Prompt construction lives in one place (`src/utils/ai.ts`) and is shared by both transport modes,
so proxy and direct produce identical output.

### 4.2 Transport — two modes, one client interface

**Proxy (default, requires an account).**

```
POST /ai/complete
  Authorization: Bearer <token>
  { task: 'improve' | 'translate', text: string, targetLang?: string }
→ { result: string }
```

The server holds the provider URL, model, and key from its own environment. It **never accepts a
base URL, model, or key from the client** — accepting a URL turns the endpoint into an SSRF
gadget, and accepting a key means the server is asked to forward a secret it cannot vouch for.
Limits at the route boundary, alongside the existing JSON-schema validation: `text` ≤ 20 000
characters, `targetLang` matched against an allowlist, and a per-user rate limit (20/minute,
300/day) returning `429`. Missing provider config on the server answers `503` with a message the
UI can show, not a stack trace.

**Direct (no account).** The browser calls the user's own OpenAI-compatible `baseUrl` with their
own key from settings. This is the mode that keeps the feature reachable without a backend, per
the local-first constraint. Its trade-off is stated in the settings UI: the key lives in
`localStorage` and is therefore exposed to any XSS. That risk is why proxy is the default, and why
`src/utils/markdown.ts`'s escape-first and `safeUrl` invariants must not be relaxed while this
mode exists.

`callAi(task, text, settings)` picks the mode; every caller sees one function and one error type.

### 4.3 Response cache

Repeated requests must not hit the network or the bill twice.

- **Key:** `SHA-256` over `task | model | targetLang | text`, via `crypto.subtle.digest` — the
  call site is already async. A cheap non-cryptographic hash is rejected here: a collision would
  serve one note's translation for another's, which is a data-corruption bug, not a cache miss.
- **Store:** `localStorage` key `notebook_ai_cache`, through the existing `src/utils/storage.ts`
  wrapper. Entries `{ key, result, task, createdAt, lastUsedAt }`.
- **Bound:** 50 entries and ~256 KB, whichever binds first; eviction is least-recently-used on
  `lastUsedAt`. `localStorage` is a small shared budget with the notes themselves — an unbounded
  cache would eventually cost the user their ability to save a note, which is unacceptable for a
  convenience feature.
- **Scope:** per device, never synced, cleared on sign-out along with the token, and clearable
  from the settings AI section (with the current entry count shown).
- **Never cached:** failures, empty results, and requests made while `settings.ai.cache` is off.
- **Bypass:** the result popover offers «دوباره تولید کن», which forces a miss and overwrites the
  entry — a cache the user cannot escape is a bug report waiting to happen.

Client-side placement is deliberate: it serves both transport modes with one implementation and
saves the request before it leaves the device. A server-side cache would only help the proxy mode
and is not built.

### 4.4 Result flow

The result **never silently replaces the user's text.** It opens in a popover showing the output
with «جایگزین کن» / «کپی» / «دوباره تولید کن» / «لغو», plus a cache-hit indicator. Replacement goes
through the ordinary `onUpdate` path, so it debounces, marks `dirty`, and is undoable like any
other edit.

States that must be designed, not improvised: no configuration yet (link straight to the settings
section), offline, rate-limited (`429`), provider error, and empty selection.

**Gate:** `npm run check` for the cache key, LRU eviction, byte cap, and prompt building;
`cd server && npm test` for the AI route's auth, size limit, rate limit, and language allowlist.

---

## Phase 5 — Multi-cursor, behind an experimental gate

`settings.experimentalEditor` switches the body field from `<textarea>` to CodeMirror 6 with
`EditorState.allowMultipleSelections` (Alt+click, Alt+drag). Off by default; the label says
آزمایشی.

To ship, the CodeMirror path must preserve everything the textarea already gets right:

- independent `dir` for title and body via `useTextDirection` — the whole reason `dir="auto"` was
  rejected;
- the 500ms debounce → `onUpdate` contract, unchanged;
- content-driven height inside the document's single scroll container, without reintroducing the
  scroll jump that `Editor.tsx:86-94` exists to prevent;
- the `key={activeNote.id}` remount contract from `App.tsx:117`;
- the focus behaviour from Phase 0;
- the context menu from Phase 3.

**Exit criterion, decided in advance:** if caret placement, selection, or bidi handling in Persian
RTL text is worse than the textarea's, the phase is deleted. It is last and gated precisely so
that outcome costs nothing already shipped. The dependency is loaded lazily so users who never
enable it never download it.

---

## 3. Risks

| Risk | Mitigation |
| --- | --- |
| Server column migration corrupts the bind-mounted SQLite file | Idempotent `PRAGMA table_info` guard; a test that migrates a populated DB and asserts row preservation; a documented backup step in the deploy notes |
| Client sends `groupId` before the server schema accepts it → whole push rejected (`additionalProperties: false`) | Server and client field ship in the same commit; the server test covers a push carrying `groupId` |
| Drag-to-group fights the mobile sheet's own drag | Drag is desktop-only; touch uses the menu path |
| Provider key in `localStorage` (direct mode) | Proxy is the default; the risk is stated in the UI; markdown XSS invariants stay locked |
| AI cache evicts a note write by filling `localStorage` | Hard entry and byte caps, LRU eviction, user-clearable |
| CodeMirror degrades Persian RTL editing | Last phase, off by default, pre-agreed deletion criterion |

## 4. Definition of done, per phase

1. `DESIGN.md` section for any new component written **before** the component.
2. `npm run build` (type errors fail the build) and `npm run lint` clean.
3. `npm run check` extended and passing.
4. `cd server && npm test` and `npm run typecheck` passing, for phases touching the server.
5. `DESIGN.md` §8 checklist walked at 375 / 768 / 1024 / 1440, both themes.
6. Review checkpoint with the user before the next phase starts.
