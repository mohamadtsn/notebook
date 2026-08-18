# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server
npm run build    # tsc -b && vite build (type errors fail the build)
npm run lint     # eslint .
npm run preview  # serve dist/
```

No test runner is installed for the frontend. `README.md` covers local and production setup — keep it in sync when deployment changes.

```bash
cd server && npm test        # node:test, the sync/auth checks
cd server && npm run typecheck
cp .env.example .env && docker compose up -d --build    # repo root; needs a real JWT_SECRET
# --build is mandatory: frontend-build COPYs the source into its image, so without
# it Compose rebuilds the previous commit into ./dist and the deploy silently no-ops.
```

## Reference docs (read before UI or feature work)

- **`DESIGN.md` — the design system. Any change to visuals, layout, or motion must come from a token or rule in it.** Colors, glass materials, type scale, motion tokens, component specs, RTL rules, the accessibility floor, and the anti-pattern table all live there. If a decision isn't covered, add it to `DESIGN.md` first, then build.

## Architecture

Single-page, offline-only notebook. React 19 + TypeScript + Vite + Tailwind v4. No router, no state library, no backend.

**State lives in one hook.** `src/hooks/useNotes.ts` holds the entire `Note[]` plus `activeNoteId` in `useState`, and every mutator follows the same shape: `setNotes(prev => { const updated = ...; persist(updated); return updated; })`. Persistence is synchronous inside the state updater — there is no save effect. `App.tsx` destructures the hook and passes callbacks down; components are presentational and never touch storage.

**Storage**: `src/utils/storage.ts` wraps localStorage with try/catch JSON get/set. Keys: `notebook_notes`, `notebook_dark`. Per PLAN.md this abstraction is the intended single swap point for a future backend — keep persistence out of components.

**Soft delete**: notes are never removed on delete; `deletedAt` is stamped and `activeNotes` / `trashedNotes` are derived filters. `permanentDelete` is the only hard removal.

**Editor auto-save**: `Editor.tsx` keeps local `title`/`body` state, runs it through `useDebounce(…, 500)`, and calls `onUpdate` from an effect. `App.tsx` passes `key={activeNote.id}` to remount the editor on note switch — that remount is what resets the local draft state, so don't drop it.

**RTL/LTR**: this is a Persian-first app. `detectDirection` (`src/utils/direction.ts`) scans for the first strong character and **defaults to `rtl`** when the text has none. Title and body each get their own `dir` via `useTextDirection` — the native `dir="auto"` was rejected because it only inspects the first strong char of the whole value. User-facing strings in components are Persian; match that when adding UI text.

**Markdown**: `src/utils/markdown.ts` is `markdown-it` + `DOMPurify`, and its output goes into
`dangerouslySetInnerHTML` in the editor preview — so this file is an XSS surface with two layers and
**both must stay**:

- **`html: false`** on the markdown-it instance, so raw HTML in a note is escaped by the parser and
  never parsed.
- **DOMPurify on the result**, with an explicit `ALLOWED_TAGS`/`ALLOWED_ATTR` allowlist. This is
  what actually strips an `onerror=` or a `javascript:` href if the parser ever lets one through.
  The `target`/`rel` on external links is set in an `afterSanitizeAttributes` hook, because
  DOMPurify drops `target` on its own pass.

Images (`![]()`) are deliberately disabled: they need `onerror` handling, and a previewed note must
not be able to call a third-party host. `src/utils/checks.ts` asserts all of this — it installs a
jsdom window so the assertions run the pipeline that actually ships. Run `npm run check` after any
edit here.

(This replaced a hand-rolled line-based renderer. Do not reintroduce one — the escape-first ordering
it depended on was a standing footgun, and it could not render tables, blockquotes or nested lists.)

**Editor undo**: the body `<textarea>` is `hidden` in preview mode, never unmounted — the browser's
undo stack belongs to the element, so unmounting it threw away every `Ctrl+Z`. For the same reason,
programmatic edits (the context menu's cut/paste) go through `document.execCommand('insertText')`
rather than `setBody`: assigning `value` wipes the stack.

## Sync (optional, client side)

Sync is opt-in: with no account the app is exactly v1, and signing out clears the token but **keeps
every local note**. Local writes never wait on the network — `patchNote` in `useNotes.ts` stamps
`dirty: true` on every mutation and persistence stays synchronous.

`useSync.ts` runs push-dirty → pull-since-cursor → merge, triggered by focus, `online`, a 60s timer,
and the manual button — never a keystroke. It reads `notes`/`token` through a ref so the listeners
register once. **`applySync` in `useNotes.ts` is the only write path for remote data**, and it merges
and clears `dirty` in one state update.

`src/utils/merge.ts` is pure and is where the risk lives: last-write-wins on `updatedAt`, except that
**any note still marked `dirty` is never replaced** — not just the open one. Unpushed text is unpushed
text whether or not the user has switched away from it. Push runs before pull in the same cycle, so a
still-dirty note's remote copy is usually the echo of our own push; if the push failed, the local edit
stays queued and wins by `updatedAt` next time. `toWire` (in `types/note.ts`) lists fields explicitly because the
server rejects unknown properties; add new local-only fields there, not by spreading.

`src/utils/checks.ts` covers the merge rules; run `npm run check` after touching any of it.

## AI (optional, both sides)

`src/utils/ai.ts` has one `callAi` entry point behind two transports: **proxy** (needs an account;
the key lives in the server's env) and **direct** (no account; the user's own OpenAI-compatible
endpoint, key stored on the device only). `buildMessages` is shared by both, because the cache key
does not record which transport produced a result.

- **`ai.apiKey` is never synced.** `toWireSettings` in `types/settings.ts` omits it structurally,
  not by deletion. A provider key is a device credential, not a preference.
- **The server accepts no base URL, model, or key from the client.** `providerFromEnv()` reads all
  three from `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL`; a client-supplied base URL would make
  `POST /ai/complete` an SSRF gadget. The prompt is built server-side too — `server/src/ai.ts`
  deliberately duplicates `buildMessages` rather than accepting messages.
- With those env vars unset the route answers **503**, not 500, so the UI can say "not configured"
  instead of showing a server error for something that is not broken. Quota is per user per day
  (`ai_usage` table, `AI_DAILY_LIMIT`) and is counted **before** the provider call, so a timeout is
  not a free retry loop.
- `src/utils/aiCache.ts` is an LRU in localStorage keyed by SHA-256 of
  `task + model + targetLang + text` (NUL-joined, so field boundaries are unambiguous). Capped at
  50 entries / 256KB — it shares one budget with the notes. `AiResult` fires **once per mount**
  (StrictMode double-invokes effects, and the second call is real money).
- Sign-out **clears the cache but keeps every local note**. Cache is derived data; notes are a
  product promise.

## Editor history

`src/utils/history.ts` + `src/hooks/useHistory.ts` own undo/redo, and the native `Ctrl+Z` is
intercepted in `Editor.tsx` so the two stacks cannot diverge. The store is module-scope and
persisted under `notebook_history`, because the editor remounts on every note switch (`key={id}`
in `App`) — history in component state would die there. Steps coalesce inside 700ms, cap at 100 per
note, and whole notes are evicted (never truncated) at 512KB.

## Backend (`server/`)

Fastify 5 + SQLite, storage only — no business logic beyond sync. **No build step**: Node 24 strips
types, so `node src/index.ts` runs the sources directly. That means explicit `.ts` import extensions
and no enums/namespaces/parameter-properties. `node:sqlite`'s `DatabaseSync` is the driver — not
`better-sqlite3` — so the alpine image needs no native toolchain.

`buildApp({ db, jwtSecret, origin })` in `src/index.ts` is exported for tests (`app.inject()`); the
listen block only runs when the file is the entry point. The server **refuses to boot** without a
`JWT_SECRET` of ≥32 chars.

Sync is last-write-wins on `updatedAt`, with `deletedAt` tombstones and a `(id, user_id)` composite
PK. **Every sync statement filters on the `user_id` from the token**, never on client input — that is
what makes cross-user id collisions unreachable. Body shapes are validated by JSON schema at the
route boundary; keep new fields there too.

The SQLite file lives on a **host bind mount** (`./data`, gitignored), deliberately not a docker
volume — the user wants a file no docker command can wipe. Compose runs the container as
`${UID}:${GID}` to keep it host-owned; don't switch it back to a named volume.

## Floating layers

`ui/ContextMenu.tsx` is the one pointer/anchor-positioned surface: `position: fixed`, clamped to the
viewport, **portalled to `document.body`**. The portal is not optional — `fixed` resolves against the
nearest transformed ancestor, and every panel these menus open over is motion-animated, so rendering
in place re-bases the clamped coordinates onto the panel. `ui/Select.tsx`, the editor menu, the note
row menu and the AI popover all sit on it. `ui/Popover.tsx` stays `absolute` and is for triggers that
are not inside a scroll container.

**A vertical scroller must declare both axes.** CSS promotes the other axis from `visible` to `auto`
as soon as one scrolls, and `IconButton`'s 44px touch pad (`after:-inset-1`) reaches 4px outside its
own box — which is how the note list grew a stray horizontal scrollbar. Every `overflow-y-auto` in
`src/components` also carries `overflow-x-hidden`.

## Styling

Tailwind v4, configured entirely in `src/index.css` — no `tailwind.config.ts`. Semantic colors are CSS variables mapped through `@theme inline`; use those rather than raw Tailwind palette colors so dark mode works — **never a raw hex in a component**. Dark mode is a `.dark` class on `<html>` via `@custom-variant`, toggled by `useDarkMode`. Markdown preview styling is plain CSS under `.markdown-preview`.

The token names, glass utilities, type scale, and motion values are specified in **`DESIGN.md`** — that file wins over anything currently in `index.css` while the Phase 1 rewire is in progress. Use logical CSS properties only (`ps-`/`pe-`/`start-`/`end-`); a physical `left`/`right` is a bug in an RTL-first app.