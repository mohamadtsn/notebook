# Search Overhaul (List Search + In-Note Search) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Persian-first, offset-preserving search engine powering both real-time Sidebar/Command-Palette note list search (with ranked multi-token matching, match-centered snippets, and highlights) and a full-featured In-Note Find & Replace bar (`Ctrl+F`) across all three editor modes (Textarea, CodeMirror 6, and Markdown Preview).

**Architecture:** One pure module (`src/utils/search.ts`) handles Persian/Latin normalization (`ي/ی`, `ك/ک`, digits `۰-۹/٠-٩/0-9`, diacritics, ZWNJ `\u200C`) while maintaining a UTF-16 index map (`normToRaw`) so every normalized match maps back to exact character offsets in the raw string. List search (`Sidebar.tsx`, `NoteItem.tsx`, `CommandPalette.tsx`) and In-Note search (`EditorSearchBar.tsx`, `Editor.tsx`, `CodeEditor.tsx`) both consume this single module. All UI surfaces strictly follow `DESIGN.md` tokens, logical RTL properties, and the required design/craft skills.

**Tech Stack:** React 19, TypeScript, Tailwind v4, `motion/react`, `@codemirror/view` + `@codemirror/state`, `lucide-react`.

**Spec:** `docs/superpowers/specs/2026-11-01-search-overhaul-design.md`

---

## Required Skills (Mandatory for Every Task)

Before starting implementation and throughout every task, the executing agent **MUST** load and apply these skills:

| Skill | How & When It Must Be Applied in This Plan |
| --- | --- |
| **`berkeh` (`bk`)** | Run `rtk bk start "<task>"` at session start; update task status (`rtk bk set T-X status=doing` / `status=done`) and log progress (`rtk bk log T-X "..."`) after each task; record any new decisions/gotchas; close with `rtk bk end "<handoff>"`. |
| **`antislop`** | Resolve mode as `antislop active: during (session override).` Enforce Hard Gates & Purpose Gates: zero fabricated states, no em-dash slop in Persian UI copy, explicit empty states with cause + next action (R-27), full keyboard path (R-32), ≥4.5:1 contrast (R-25), ≥44×44px touch targets (R-03), `cursor: pointer` on controls (R-39), verify before delivery (R-35). |
| **`antislop-ui`** | Enforce glass dose caps (R-10: never stack glass on glass; Sidebar search is solid `bg-fill` inside `bg-surface`; `EditorSearchBar` is `glass-panel` over scrolling text), single accent color (`--accent` / `--accent-soft` / `--selection`), no decorative dots/stripes/badges without state meaning (R-31). |
| **`emil-design-eng`** | Apply the Animation Decision Framework: **0ms instant open** when `EditorSearchBar` or `CommandPalette` is opened via keyboard (`Ctrl+F`, `Ctrl+K`, `Esc`), `popIn` (`scale(0.96)` → `1`, `< 200ms`, `--ease-out-strong`) when opened via pointer click. Add `active:scale-[0.97]` over `duration-(--d-press)` on pressable buttons. Never use `transition: all` or `ease-in`. |
| **`apple-design`** | Zero-latency response: search filtering and match highlighting run synchronously in `useMemo` with **no artificial debounce** on the input path. Maintain spatial consistency (enter/exit along the same path), independent `dir` detection via `useTextDirection`, Persian numerals (`fa-IR`) for counters, and `@media (prefers-reduced-motion: reduce)` / `@media (prefers-reduced-transparency: reduce)` fallbacks. |
| **`design-taste-frontend`** | Follow `DESIGN.md` as the authoritative design read (`Calm over loud`, one accent, shape radius lock `--r-sm`/`--r-md`/`--r-lg`, tactile `:active` feedback, copy self-audit for natural Persian). Run the Pre-Flight Check across light/dark themes and `375px` / `768px` / `1024px` / `1440px` viewports before completion. |

---

## Global Constraints

- **No commits** unless explicitly requested by the user.
- **`DESIGN.md` first:** Task 1 updates `DESIGN.md` before any component code is written.
- **No raw hex in a component:** use semantic tokens (`bg-surface`, `bg-fill`, `text-ink`, `text-ink-soft`, `text-muted`, `bg-accent`, `bg-accent-soft`, `bg-selection`, `border-separator`).
- **Logical CSS only:** `ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`, `inset-e-`, `border-s-`. Never `left`/`right`/`pl-`/`pr-` (except CodeMirror's documented caret override).
- **Persian UI copy:** all user-facing labels, placeholders, aria-labels, and empty states are natural Persian.
- **`npm run check` & `npm run build` & `npm run lint`:** must pass after every task.

## Review Focus

1. **Persian character & ZWNJ offset drift:** Stripping diacritics (`\u064B-\u065F`), tatweel (`\u0640`), or ZWNJ (`\u200C`) changes string length. If `findMatches` returns indices into the normalized string instead of mapping back via `normToRaw`, highlights in `<textarea>`, CodeMirror, and `<HighlightText>` will slice the wrong characters and split surrogate pairs or words. Task 2 pins this with exact UTF-16 offset assertions in `src/utils/checks.ts`.
2. **Replacing matches while normalized length differs from raw length:** Searching `می روم` (6 chars) and replacing a matched `می‌روم` or `مـی‌روم` (7 chars) must slice `[match.from, match.to]` from the raw string, never `match.from + query.length`. Task 2's `replaceMatches` helper pins this in `src/utils/checks.ts`.
3. **XSS invariance in Markdown Preview search highlighting:** Highlighting matches in `mode === 'preview'` must never pass raw `<mark>` tags through `markdown-it` or bypass `DOMPurify`. Task 5 highlights exclusively by walking DOM text nodes (`NodeFilter.SHOW_TEXT`) *after* `renderMarkdown(body)` has sanitized the HTML.
4. **Escape key collision between `EditorSearchBar`, `CodeEditor` multi-cursor, and `App` note deselection:** Pressing `Escape` inside `EditorSearchBar` must close the search bar and focus the editor — it must *not* deselect the active note in `useKeyboardShortcuts.ts`. Task 5 calls `e.preventDefault()` and `e.stopPropagation()` on `Escape` when the find bar is open.
5. **Group-filtered false-negative in Sidebar search:** A user searching while inside a specific group (e.g. «کار») may forget they are filtered to that group. When the current group has 0 matches but other notes match, `Sidebar.tsx` must show a clear button to switch to «همه» and reveal those N matches (`antislop` R-27).

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `DESIGN.md` | Modify (§6, §8) | Specify `Sidebar search field`, `In-note search bar`, and `Match highlight` tokens/rules |
| `src/utils/search.ts` | Create | Pure Persian/Latin normalizer with offset map (`normalizeWithMap`), `findMatches`, `replaceMatches`, `buildSnippet`, and ranked `searchNotes` |
| `src/utils/checks.ts` | Modify | Unit assertions for Persian normalization, offset mapping, ZWNJ equivalence, multi-token ranking, snippet extraction, and replacement |
| `src/components/ui/HighlightText.tsx` | Create | Presentational helper that renders a string + `MatchRange[]` as safe text with `<mark>` spans |
| `src/components/NoteItem.tsx` | Modify | Render highlighted title, match-centered snippet, and match count badge when search results are provided |
| `src/components/Sidebar.tsx` | Modify | Replace static search button with live inline search field (`bg-fill`), clear button, group-aware empty state, and `Ctrl+K` trigger |
| `src/components/CommandPalette.tsx` | Modify | Upgrade note search to use `searchNotes` (including trashed notes ranked after active notes) + `<HighlightText>` |
| `src/components/EditorSearchBar.tsx` | Create | Floating `glass-panel` in-note Find & Replace bar (`Ctrl+F`), match counter (`۲ از ۷`), prev/next, `Aa` & whole-word toggles, replace/replace-all |
| `src/components/EditorToolbar.tsx` | Modify | Add `Search` (`جستجو در یادداشت`) `IconButton` trigger |
| `src/components/CodeEditor.tsx` | Modify | Add CodeMirror `StateEffect` + `StateField` search match decorations (`.cm-searchMatch`, `.cm-searchMatch-selected`) and `scrollToRange` on `CodeEditorHandle` |
| `src/components/Editor.tsx` | Modify | Wire `EditorSearchBar`, `Ctrl+F` shortcut, textarea backdrop highlight mirror, Markdown preview text-node highlighter, and undoable replace via `applyBody` |
| `src/hooks/useKeyboardShortcuts.ts` | Modify | Add `onFocusSidebarSearch` (`Ctrl+Shift+F`) and ensure `Escape` yields when in-note search is open |
| `src/components/ShortcutsHelp.tsx` | Modify | Document `Ctrl+F` («جستجو در متن یادداشت») and `Ctrl+Shift+F` («جستجو در لیست یادداشت‌ها») |
| `src/App.tsx` | Modify | Pass trashed notes to `CommandPalette`, coordinate active search query handoff from Sidebar/Palette to Editor |

---

### Task 1: Update `DESIGN.md` with Search Specifications

**Files:**
- Modify: `DESIGN.md:218-290`

**Skills to apply:** `berkeh`, `antislop`, `antislop-ui`, `apple-design`, `emil-design-eng`, `design-taste-frontend`

- [ ] **Step 1: Start task in Berkeh and add search component specs to `DESIGN.md` §6**

Run `rtk bk set T-1 status=doing` and add the following specifications under `## 6. Components` in `DESIGN.md`:

```markdown
**Sidebar search field** — inline `--fill` input (`--r-sm`, `min-height: 40px`, touch target ≥44px) sitting above the note rows inside the sidebar's scroll container. Tier-2 focus (`ring-2 ring-accent` + `shadow-[0_0_0_4px_var(--accent-soft)]`). Never glass: the sidebar itself is a `--surface` card. Carries a leading `Search` icon, an inline-end clear (`X`) button when non-empty, and a `Ctrl K` hint chip when empty that opens the command palette. Filters the current view (`notes` or `trash`) synchronously with zero artificial debounce. When a group filter yields 0 matches while matches exist across all notes, the empty state names the count and offers a one-tap switch to «همه».

**In-note search bar (`EditorSearchBar`)** — `glass-panel` (`--r-lg`) anchored at the top-inline-start of the editor sheet (opposite the toolbar pill at top-inline-end so the two never overlap on desktop, stacking cleanly below the toolbar on narrow viewports). Opened by `Ctrl+F` (instant, 0ms animation — §5) or the toolbar search button (`popIn`, `springUI`). Contains a search input (`dir` from `useTextDirection`), a live match counter in Persian numerals (`۲ از ۷` or `بدون نتیجه`, `aria-live="polite"`), previous/next buttons (`Enter` / `Shift+Enter`), toggles for exact match (`Aa`) and whole word, and an expandable replace row in `write` mode («جایگزینی» / «همه», routed through the editor's undoable `applyBody` path). `Esc` closes the bar and restores focus and selection to the active match in the editor.

**Match highlight** — inactive matches use `--accent-soft` background with `--ink` text; the active/focused match in the editor uses `--selection` background with a `1px solid var(--accent)` outline (`rounded-[2px]`). In the plain `<textarea>`, highlights render in a synchronized `aria-hidden` backdrop mirror layer sharing the textarea's grid cell and typography; in CodeMirror, via `Decoration.mark`; in Markdown preview, via a post-sanitize DOM text-node pass.
```

- [ ] **Step 2: Verify `DESIGN.md` formatting and log in Berkeh**

Run: `rtk git diff DESIGN.md && rtk bk set T-1 status=done`
Expected: Clean diff with no raw hexes outside token tables and all rules aligned with `DESIGN.md` §1–§9.

---

### Task 2: Build Offset-Preserving Persian & Latin Search Engine (`src/utils/search.ts`)

**Files:**
- Create: `src/utils/search.ts`
- Modify: `src/utils/checks.ts`

**Skills to apply:** `berkeh`, `superpowers:test-driven-development`

**Interfaces:**
- Consumes: `Note` from `src/types/note.ts`, `Group` from `src/types/group.ts`
- Produces:
  - `export interface MatchRange { from: number; to: number }`
  - `export interface SearchOptions { caseSensitive?: boolean; wholeWord?: boolean }`
  - `export interface Snippet { text: string; matches: MatchRange[]; prefixEllipsis: boolean; suffixEllipsis: boolean }`
  - `export interface NoteSearchResult { note: Note; score: number; titleMatches: MatchRange[]; bodyMatchCount: number; firstBodyMatch: MatchRange | null; snippet: Snippet }`
  - `export function normalizeWithMap(text: string, caseSensitive?: boolean): { normalized: string; map: number[] }`
  - `export function findMatches(text: string, query: string, options?: SearchOptions): MatchRange[]`
  - `export function replaceMatches(text: string, matches: MatchRange[], replacement: string, index?: number): { value: string; caret: number }`
  - `export function buildSnippet(body: string, query: string, maxLen?: number): Snippet`
  - `export function searchNotes(notes: Note[], query: string, groups?: Map<string, Group>): NoteSearchResult[]`

- [ ] **Step 1: Write the failing assertions in `src/utils/checks.ts`**

Import `{ normalizeWithMap, findMatches, replaceMatches, buildSnippet, searchNotes } from './search.ts'` in `src/utils/checks.ts` and append assertions covering:
1. Arabic Yeh/Kaf (`كتاب يادداشت` matches `کتاب یادداشت` with exact raw offsets `{ from: 0, to: 12 }`).
2. Persian, Arabic-Indic, and ASCII digits (`سال ۱۴۰۳` matches `1403` at `{ from: 4, to: 8 }`).
3. Diacritics and tatweel stripping (`سَـلٰام دنیا` matches `سلام` with raw offsets `{ from: 0, to: 7 }` spanning the full decorated word, and `دنیا` at `{ from: 8, to: 12 }`).
4. Half-space (ZWNJ `\u200C`) equivalence:
   - `می‌روم به خانه` matched by `می روم` (space) -> `{ from: 0, to: 6 }`
   - `می‌روم به خانه` matched by `میروم` (no ZWNJ) -> `{ from: 0, to: 6 }`
   - `می روم به خانه` matched by `می‌روم` (ZWNJ) -> `{ from: 0, to: 6 }`
5. `caseSensitive: true` (exact match mode): `Hello` does not match `hello`, and Arabic `ي` does not match `ی`.
6. `wholeWord: true`: `کار` matches `این کار خوب است` at `{ from: 4, to: 7 }` but does NOT match `کارخانه` or `همکار`.
7. `replaceMatches`: replacing a diacritic/ZWNJ-normalized match (`مـی‌روم` length 7 matched by `میروم` length 5) with `رفتم` produces `'رفتم به خانه'` without leaving trailing characters.
8. `buildSnippet`: extracts a window around a match at offset 300 of a long note, sets `prefixEllipsis: true`, and shifts `snippet.matches` to match the sliced `snippet.text`.
9. `searchNotes`: multi-token query `'پروژه ری‌اکت'` matches a note with `'پروژه'` in title and `'ری اکت'` in body; ranks an exact title match above a body-only match.

- [ ] **Step 2: Run `npm run check` to verify it fails**

Run: `rtk npm run check`
Expected: FAIL with `Cannot find module './search.ts'`.

- [ ] **Step 3: Implement `src/utils/search.ts`**

Implement `normalizeWithMap`, `findMatches` (supporting both standard normalized pass and ZWNJ-collapsed pass when `caseSensitive` is false, merging and deduplicating ranges), `replaceMatches`, `buildSnippet`, and `searchNotes`.

- [ ] **Step 4: Run `npm run check` to verify all assertions pass**

Run: `rtk npm run check`
Expected: PASS (`checks passed`).

---

### Task 3: Create `<HighlightText>` & Upgrade `NoteItem.tsx`

**Files:**
- Create: `src/components/ui/HighlightText.tsx`
- Modify: `src/components/NoteItem.tsx`

**Skills to apply:** `berkeh`, `antislop`, `antislop-ui`, `apple-design`, `design-taste-frontend`

**Interfaces:**
- `HighlightText`:
  - Props: `{ text: string; ranges?: MatchRange[]; className?: string; markClassName?: string }`
- `NoteItemProps` (extend in `src/components/NoteItem.tsx`):
  - Add optional `searchResult?: NoteSearchResult`

- [ ] **Step 1: Create `src/components/ui/HighlightText.tsx`**

Render `text` sliced by sorted non-overlapping `ranges`. Wrap matched segments in `<mark className={cx('rounded-[2px] bg-selection text-ink font-medium px-[1px]', markClassName)}>`. When `ranges` is empty or undefined, render `text` as a plain fragment with zero extra DOM nodes.

- [ ] **Step 2: Update `src/components/NoteItem.tsx` to display highlighted titles, match-centered snippets, and match count**

When `searchResult` is passed to `NoteItem`:
- Render `title` via `<HighlightText text={title} ranges={searchResult.titleMatches} />` (only when `note.title.trim()` is non-empty).
- Render the preview line using `searchResult.snippet` (`prefixEllipsis` + `<HighlightText text={searchResult.snippet.text} ranges={searchResult.snippet.matches} />` + `suffixEllipsis`) instead of the static top-of-note `preview`.
- When `searchResult.bodyMatchCount > 0`, show a subtle pill/caption in the metadata row (`${searchResult.bodyMatchCount.toLocaleString('fa-IR')} تطابق`).

- [ ] **Step 3: Verify build and types**

Run: `rtk npm run build`
Expected: PASS with 0 TypeScript or Vite errors.

---

### Task 4: Upgrade `Sidebar.tsx` & `CommandPalette.tsx` for Real-Time List Search

**Files:**
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/components/CommandPalette.tsx`
- Modify: `src/App.tsx`

**Skills to apply:** `berkeh`, `antislop`, `antislop-ui`, `emil-design-eng`, `apple-design`, `design-taste-frontend`

**Interfaces:**
- `SidebarProps`:
  - Add `searchQuery: string`, `onSearchQueryChange: (q: string) => void`, `searchInputRef?: React.RefObject<HTMLInputElement | null>`, `onSelectSearchResult?: (id: string, query: string) => void`
- `CommandPaletteProps`:
  - Add `trashedNotes: Note[]`, `onSelectSearchResult?: (id: string, query: string) => void`

- [ ] **Step 1: Replace the static search button in `src/components/Sidebar.tsx` with a live search field**

- Render an inline search container (`flex flex-1 items-center gap-1.5 rounded-lg bg-fill px-2.5 min-h-10 transition-[box-shadow,border-color] duration-(--d-fast) focus-within:ring-2 focus-within:ring-accent focus-within:shadow-[0_0_0_4px_var(--accent-soft)]`):
  - Leading `<Search size={14} className="shrink-0 text-muted" />`
  - `<input ref={searchInputRef} type="search" value={searchQuery} onChange={e => onSearchQueryChange(e.target.value)} dir={searchDir} placeholder={view === 'trash' ? 'جستجو در سطل زباله…' : 'جستجو در یادداشت‌ها…'} aria-label="جستجو در لیست یادداشت‌ها" className="min-w-0 flex-1 bg-transparent py-2 text-sm text-ink outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden" />`
  - When `searchQuery` is non-empty: render a clear `<button type="button" onClick={() => { onSearchQueryChange(''); searchInputRef?.current?.focus(); }} aria-label="پاک کردن جستجو" className="relative flex size-6 shrink-0 items-center justify-center rounded-md text-muted hover:text-ink active:scale-[0.97] after:absolute after:-inset-2 after:content-['']"><X size={14} /></button>`.
  - When `searchQuery` is empty: render a `<button type="button" onClick={onOpenSearch} aria-label="باز کردن پالت دستورها (Ctrl+K)" title="پالت دستورها (Ctrl+K)" className="shrink-0 rounded border border-separator bg-surface/60 px-1.5 py-0.5 font-mono text-[.6875rem] text-muted transition-colors hover:text-ink active:scale-[0.97]">Ctrl K</button>`.
- When `searchQuery.trim()` is non-empty:
  - Run `searchNotes(filtered, searchQuery, allGroupsMap)` synchronously in `useMemo`.
  - Also compute `allViewMatchesCount` when `view === 'notes' && selectedGroup !== 'all'` so if the current group has 0 matches, the empty state displays:
    - «در این گروه موردی پیدا نشد»
    - If `allViewMatchesCount > 0`: a button «نمایش ${allViewMatchesCount.toLocaleString('fa-IR')} نتیجه در همهٔ یادداشت‌ها» that calls `onSelectGroup('all')`.
    - Plus a button «پاک کردن جستجو» that clears `searchQuery` (`antislop` R-27).
  - Pass `searchResult` to each `NoteItem`, and when clicked while `searchQuery.trim()` is non-empty, call `onSelectSearchResult(note.id, searchQuery.trim())` so the editor can highlight the searched term inside the opened note!

- [ ] **Step 2: Upgrade `src/components/CommandPalette.tsx` to use `searchNotes` and `<HighlightText>`**

- When `query.trim()` is non-empty:
  - Run `searchNotes(notes, query)` for active notes and `searchNotes(trashedNotes, query)` for trashed notes.
  - Combine `[...activeResults, ...trashedResults]` and take `.slice(0, 12)`.
  - Render each note result's label with `<HighlightText text={title} ranges={r.titleMatches} />` and its `hint` with `<HighlightText text={r.snippet.text} ranges={r.snippet.matches} />` (or «در سطل زباله» badge when `r.note.deletedAt` is set).
  - When selecting a note while `query.trim()` is non-empty, call `onSelectSearchResult(r.note.id, query.trim())`.

- [ ] **Step 3: Check `npm run check`, `npm run lint`, and `npm run build`**

Run: `rtk npm run check && rtk npm run lint && rtk npm run build`
Expected: PASS.

---

### Task 5: Build In-Note Search & Replace across All 3 Editor Modes (`EditorSearchBar.tsx`, `CodeEditor.tsx`, `Editor.tsx`)

**Files:**
- Create: `src/components/EditorSearchBar.tsx`
- Modify: `src/components/EditorToolbar.tsx`
- Modify: `src/components/CodeEditor.tsx`
- Modify: `src/components/Editor.tsx`
- Modify: `src/hooks/useKeyboardShortcuts.ts`
- Modify: `src/components/ShortcutsHelp.tsx`
- Modify: `src/App.tsx`

**Skills to apply:** `berkeh`, `antislop`, `antislop-ui`, `emil-design-eng`, `apple-design`, `design-taste-frontend`

**Interfaces:**
- `CodeEditorHandle` (extend in `src/components/CodeEditor.tsx`):
  - `setSearchHighlights(matches: MatchRange[], activeIndex: number): void`
- `EditorSearchBarProps` (`src/components/EditorSearchBar.tsx`):
  - `query: string`
  - `onQueryChange: (q: string) => void`
  - `matchCount: number`
  - `activeIndex: number` (0-based, `-1` when `matchCount === 0`)
  - `caseSensitive: boolean`
  - `onToggleCaseSensitive: () => void`
  - `wholeWord: boolean`
  - `onToggleWholeWord: () => void`
  - `onNext: () => void`
  - `onPrev: () => void`
  - `canReplace: boolean` (`!isTrash && mode === 'write'`)
  - `onReplaceCurrent: (replacement: string) => void`
  - `onReplaceAll: (replacement: string) => void`
  - `onClose: () => void`
  - `instant: boolean`
  - `inputRef: React.RefObject<HTMLInputElement | null>`

- [ ] **Step 1: Add CodeMirror search highlight decorations in `src/components/CodeEditor.tsx`**

Using `@codemirror/state` (`StateEffect`, `StateField`) and `@codemirror/view` (`Decoration`, `EditorView`), add a `searchHighlightField` extension:
- Define `setSearchEffect = StateEffect.define<{ matches: MatchRange[]; activeIndex: number }>()`
- Build a `DecorationSet` from `matches`:
  - Inactive matches get `Decoration.mark({ class: 'cm-searchMatch' })`
  - The match at `activeIndex` gets `Decoration.mark({ class: 'cm-searchMatch cm-searchMatch-selected' })`
- Add theme styles in `EditorView.theme`:
  - `'.cm-searchMatch': { backgroundColor: 'var(--accent-soft)', borderRadius: '2px' }`
  - `'.cm-searchMatch-selected': { backgroundColor: 'var(--selection)', outline: '1px solid var(--accent)', borderRadius: '2px' }`
- Implement `setSearchHighlights(matches, activeIndex)` on `CodeEditorHandle`:
  - Dispatches `setSearchEffect.of({ matches, activeIndex })`.
  - When `activeIndex >= 0 && matches[activeIndex]`, uses `view.coordsAtPos(matches[activeIndex].from)` to smoothly scroll the outer `.overflow-y-auto` document scroller if the match is outside the visible area.

- [ ] **Step 2: Create `src/components/EditorSearchBar.tsx`**

- Use `motion.div` with `{...(instant ? {} : popIn)}` and `className="glass-panel flex flex-col gap-1.5 rounded-2xl p-1.5"` (`DESIGN.md` §2, §5, §6).
- Row 1 (Find):
  - Search input (`ref={inputRef}`, `value={query}`, `dir={useTextDirection(query)}`, `placeholder="جستجو در متن یادداشت…"`, `aria-label="جستجو در متن یادداشت"`).
  - Keyboard handling on input:
    - `Enter`: `e.preventDefault()`; if `e.shiftKey` call `onPrev()`, else `onNext()`.
    - `Escape`: `e.preventDefault(); e.stopPropagation(); onClose();`
  - Live match counter (`aria-live="polite"`):
    - When `query` is empty: hidden.
    - When `query` is non-empty and `matchCount === 0`: `<span className="px-1.5 text-xs text-destructive">بدون نتیجه</span>`.
    - When `matchCount > 0`: `<span className="px-1.5 text-xs text-muted tabular-nums">{(activeIndex + 1).toLocaleString('fa-IR')} از {matchCount.toLocaleString('fa-IR')}</span>`.
  - Option toggles (`IconButton`s with `active` prop and Persian tooltips):
    - `CaseSensitive` (`Aa` / `CaseSensitive` icon, label: `تطابق دقیق حروف و نگارش`)
    - `WholeWord` (`WholeWord` icon, label: `فقط کلمهٔ کامل`)
  - Navigation buttons (`ChevronUp` for «مورد قبلی (Shift+Enter)», `ChevronDown` for «مورد بعدی (Enter)», disabled when `matchCount === 0`).
  - Replace drawer toggle button (`Replace` icon, label: `جایگزینی متن`, shown when `canReplace`).
  - Close button (`X` icon, label: `بستن جستجو (Esc)`).
- Row 2 (Replace — rendered when `replaceOpen && canReplace`):
  - Input (`value={replacement}`, `dir={useTextDirection(replacement)}`, `placeholder="جایگزینی با…"`, `aria-label="متن جایگزین"`).
  - `Enter` in replace input calls `onReplaceCurrent(replacement)`.
  - Buttons: «جایگزینی» (replaces active match via `onReplaceCurrent`) and «همه» (replaces all matches via `onReplaceAll`), disabled when `matchCount === 0`.

- [ ] **Step 3: Wire `EditorSearchBar`, `Ctrl+F`, and 3-mode highlighting into `src/components/Editor.tsx` & `src/components/EditorToolbar.tsx`**

- In `EditorToolbar.tsx`: add an `onOpenSearch?: () => void` and `searchOpen?: boolean` prop, rendering an `<IconButton label="جستجو در یادداشت (Ctrl+F)" active={searchOpen} onClick={onOpenSearch}><Search size={16} /></IconButton>`.
- In `Editor.tsx`:
  - Compute `bodyMatches = useMemo(() => findMatches(body, search.query, { caseSensitive: search.caseSensitive, wholeWord: search.wholeWord }), [body, search.query, search.caseSensitive, search.wholeWord])`.
  - Intercept `Ctrl+F` / `Cmd+F` inside `Editor.tsx`: opens the search bar with `instant: true`, focuses `searchInputRef.current`, and selects its text (or pre-fills with the current editor text selection if non-empty and single-line!).
  - **Mode A (Default `<textarea>`):**
    - Wrap the `<textarea>` and an `aria-hidden="true"` mirror backdrop `<div>` in a `relative grid` container (`[&>*]:[grid-area:1/1]`).
    - When `search.open && bodyMatches.length > 0 && mode === 'write' && !advanced`: render the backdrop `<div>` with identical typography (`w-full whitespace-pre-wrap break-words py-3 text-base leading-[1.8] text-transparent pointer-events-none select-none ${gutter}`), `dir={bodyDir}`, slicing `body` by `bodyMatches` into `<mark data-active={i === activeMatchIndex} className={i === activeMatchIndex ? 'rounded-[2px] bg-selection text-transparent outline-1 outline-accent' : 'rounded-[2px] bg-accent-soft text-transparent'}>`.
    - Scroll the `[data-active="true"]` `<mark>` into the document scroller (`scrollIntoView({ block: 'center', behavior: 'nearest' })`).
  - **Mode B (Advanced CodeMirror 6):**
    - Call `cmRef.current?.setSearchHighlights(search.open ? bodyMatches : [], activeMatchIndex)` in an effect.
  - **Mode C (Markdown Preview):**
    - Add `previewRef` to `.markdown-preview`. In `useLayoutEffect` (keyed on `[body, mode, search.open, bodyMatches, activeMatchIndex]`), re-set `previewRef.current.innerHTML = renderMarkdown(body)` and, when `search.open && search.query`, walk `NodeFilter.SHOW_TEXT` nodes to wrap matches found by `findMatches` in `<mark>` elements, scrolling the active `<mark>` into view.
  - **Replace actions:**
    - `onReplaceCurrent(replacement)`: calls `replaceMatches(body, bodyMatches, replacement, activeMatchIndex)` and passes the result to `applyBody(res.value, res.caret, res.caret)` so undo (`Ctrl+Z`), `dirty` sync flagging, and auto-save work identically to typing!
    - `onReplaceAll(replacement)`: calls `replaceMatches(body, bodyMatches, replacement)` and passes the result to `applyBody`, showing a toast (`${bodyMatches.length.toLocaleString('fa-IR')} مورد جایگزین شد`).

- [ ] **Step 4: Wire `App.tsx`, `useKeyboardShortcuts.ts`, and `ShortcutsHelp.tsx`**

- In `useKeyboardShortcuts.ts`: add `onFocusSidebarSearch` (`Ctrl+Shift+F`), and ensure `Escape` checks `if (e.defaultPrevented) return;`.
- In `ShortcutsHelp.tsx`: add `{ label: 'جستجو در متن یادداشت', keys: ['Ctrl', 'F'] }` to `EDITOR` and `{ label: 'جستجو در لیست یادداشت‌ها', keys: ['Ctrl', 'Shift', 'F'] }` to `GENERAL`.
- In `App.tsx`:
  - Hold `sidebarSearchQuery` state and `initialEditorSearch` state (`{ noteId: string; query: string; token: number } | null`).
  - When a user selects a note from a Sidebar search result or Command Palette search result with a non-empty query, set `initialEditorSearch` so `Editor` opens with `EditorSearchBar` pre-populated and scrolled to the first match!

- [ ] **Step 5: Run full verification suite & Skill Delivery Gates**

Run:
```bash
rtk npm run check
rtk npm run lint
rtk npm run build
cd server && rtk npm test && rtk npm run typecheck
```
Expected: All checks, linter, typechecks, and production build pass with 0 errors and main bundle precache size budget respected.
Walk the `antislop` / `antislop-ui` Delivery Gate and `design-taste-frontend` Pre-Flight Checklist, then log completion in Berkeh (`rtk bk end "..."`).
