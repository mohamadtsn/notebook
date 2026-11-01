# Notebook — Search Overhaul Design Spec (List Search + In-Note Search)

Date: 2026-11-01
Status: draft for review

Written in English to match `DESIGN.md` / `PRODUCT.md` / `CLAUDE.md`. All user-facing strings
specified here are Persian, per the existing product.

---

## 1. Root-Cause Audit of Current Search

An investigation of `src/components/Sidebar.tsx`, `src/components/CommandPalette.tsx`,
`src/components/NoteItem.tsx`, `src/components/Editor.tsx`, `src/components/CodeEditor.tsx`, and
`src/App.tsx` revealed seven structural problems:

1. **No Persian / Bidi text normalization (`CommandPalette.tsx:35-37`).**
   `matches` is a raw `haystack.toLowerCase().includes(needle.toLowerCase())`. It fails on:
   - Arabic vs. Persian Yeh (`ي` U+064A / `ى` U+0649 / `ئ` U+0626 vs. `ی` U+06CC) and Kaf (`ك` U+0643 vs. `ک` U+06A9)
   - Half-space (ZWNJ `\u200C`) vs. regular space (e.g. `می‌روم` vs. `می روم`)
   - Persian (`۰–۹`), Arabic-Indic (`٠–٩`), and ASCII (`0–9`) digits (`۱۴۰۳` vs. `1403`)
   - Arabic diacritics/harakat (`\u064B–\u065F`, `\u0670`) and tatweel/kashida (`\u0640`)
   - Heh + hamza (`هٔ` `\u0647\u0654` vs. `ۀ` `\u06C0`)
2. **Sidebar has no real list filter (`Sidebar.tsx:125-133`).**
   The search box in the sidebar is a button that opens `CommandPalette`. Users cannot filter the
   note list in place, browse across multiple matching notes without re-opening the modal, or see
   how many notes matched in the current group/view.
3. **Trash is completely unsearchable (`App.tsx:289`).**
   `CommandPalette` receives `notes.filter(n => !n.deletedAt)` and `Sidebar` has no filter input, so
   trashed notes cannot be searched anywhere.
4. **No multi-token matching or relevance ranking (`CommandPalette.tsx:105-114`).**
   Queries with multiple words only match contiguous substrings, and `.slice(0, 8)` runs *before*
   any relevance ranking — so a note whose body happens to contain the query can push an exact title
   match past index 8 and hide it completely.
5. **Context-blind snippets and zero match highlighting (`NoteItem.tsx:118`, `CommandPalette.tsx:111`).**
   Both surfaces always show the *first* 40 characters / first 2 lines of `note.body`, even when the
   match is deep inside the note, and neither highlights matched ranges in the title or body snippet.
6. **Zero in-note search (`Editor.tsx`, `CodeEditor.tsx`, `EditorToolbar.tsx`).**
   There is no `Ctrl+F` find bar, no match counter, no next/previous navigation, no match
   highlighting in any of the three editor modes (default `<textarea>`, experimental CodeMirror 6,
   or Markdown preview), and no find-and-replace.
7. **No search handoff from list/palette to editor.**
   Selecting a note from a search result opens the note cold without carrying the active query into
   the note or scrolling to the matched passage.

---

## 2. Standing Constraints & Required Skills

Every phase in the implementation plan inherits these rules and skill mandates:

- **Required skills to invoke during execution:**
  - `berkeh` (`bk` CLI — load workspace context at the start with `bk start`, update task statuses `bk set <ref> status=doing|done`, log progress `bk log <ref>`, record decisions/gotchas, and finish with `bk end`).
  - `antislop` & `antislop-ui` (Mode: `during` — purpose-tested visuals, no raw hexes, glass dose caps, explicit empty states with next-action affordance, ≥4.5:1 contrast, full keyboard operation).
  - `emil-design-eng` (Frequency-based animation decisions: instant open on keyboard shortcuts `Ctrl+F` and `Ctrl+K`, `popIn` under 200ms on pointer triggers, `scale(0.97)` press feedback over `--d-press`, exact `transition` property lists, never `transition: all` or `ease-in`).
  - `apple-design` (Zero-latency synchronous search filtering without artificial input debounce, spatial consistency for floating bars, `prefers-reduced-motion` and `prefers-reduced-transparency` fallbacks, optical typography, Persian numerals via `fa-IR`).
  - `design-taste-frontend` (Design Read compliance with `DESIGN.md`, single `--accent` color lock, shape radius lock, no AI-slop decorative badges or gradients, pre-flight verification across breakpoints and themes).
- **Project constraints (`CLAUDE.md` / `DESIGN.md` / `PRODUCT.md`):**
  - **No commits** unless explicitly requested by the user.
  - **`DESIGN.md` first:** new surfaces (Sidebar search field, In-note find/replace bar, match highlight tokens) are specified in `DESIGN.md` before component code is written.
  - **Logical CSS only:** `ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`, `inset-e-`, `border-s-`. Never `left`/`right`/`pl-`/`pr-`.
  - **Pure logic tested in `src/utils/checks.ts`:** `npm run check` and `npm run build` must pass at every step.

---

## 3. Architecture & Component Design

### Phase 1 — Offset-Preserving Persian & Latin Search Engine (`src/utils/search.ts`)

A pure, zero-dependency module covered by `src/utils/checks.ts`:

1. **`normalizeWithMap(text: string, options?: { caseSensitive?: boolean; exactChars?: boolean }): NormalizedText`**
   - Returns `{ normalized: string; map: number[] }` where `map[i]` is the UTF-16 code-unit index in
     `text` corresponding to index `i` in `normalized`, plus `map[normalized.length] = text.length`.
   - When `exactChars` is false (the default smart mode):
     - Maps `ي`/`ى`/`ئ` → `ی`, `ك` → `ک`, `ۀ` → `ه`, `ؤ` → `و`, `أ`/`إ`/`آ` → `ا` (configurable; keeps `آ` → `ا` so `آن` and `ان` match, while `exactChars: true` preserves exact letters).
     - Maps Persian digits `۰–۹` and Arabic-Indic digits `٠–٩` → ASCII `0–9`.
     - Strips Arabic diacritics (`\u064B–\u065F`, `\u0670`) and tatweel (`\u0640`) — their indices are skipped in `normalized` while `map` preserves the exact offsets of surviving characters.
     - Normalizes ZWNJ (`\u200C`) and whitespace runs into a single space `' '` so `می‌روم`, `می روم`, and `میروم` (via optional ZWNJ-tolerant matching) resolve cleanly.
2. **`findMatches(text: string, query: string, options?: SearchOptions): MatchRange[]`**
   - Returns `{ from: number; to: number }[]` in **raw `text` UTF-16 offsets**, non-overlapping, sorted ascending.
   - Supports `caseSensitive` (`exactChars` + case) and `wholeWord` (checks word boundaries in both Latin and Persian/Arabic scripts).
   - Handles ZWNJ-collapsed matching so searching `میروم` matches `می‌روم` (`from` and `to` span the full raw word including the ZWNJ).
3. **`searchNotes(notes: Note[], query: string, options?: { groups?: Map<string, Group> }): NoteSearchResult[]`**
   - Splits `query` into tokens (while also testing the full phrase).
   - Every token must match in `title`, `body`, or the note's group name.
   - Scores results deterministically:
     - Exact title match (+1000)
     - Title prefix match (+500)
     - Full phrase in title (+300)
     - All tokens in title (+200)
     - Full phrase in body (+100)
     - Match count bonus (+5 per match, capped at +50)
     - Pinned boost (+25)
     - Tie-breaker: `updatedAt` descending (or the caller's active `SortOrder`).
   - Produces for each note:
     - `note: Note`
     - `score: number`
     - `titleMatches: MatchRange[]`
     - `bodyMatchCount: number`
     - `snippet: { text: string; matches: MatchRange[]; prefixEllipsis: boolean; suffixEllipsis: boolean }` — a ~90-char window centered around the first match in `body`, with `matches` re-based to `snippet.text` offsets so `<HighlightText>` can render it directly.

### Phase 2 — Sidebar List Search & Command Palette Upgrade (`Sidebar.tsx`, `NoteItem.tsx`, `CommandPalette.tsx`)

1. **Inline Search Input in `Sidebar.tsx`:**
   - Replaces the static button in `Sidebar.tsx` with a real inline search input (`bg-fill`, Tier-2 focus ring `focus-within:ring-2 focus-within:ring-accent`, `dir` from `useTextDirection(query)`).
   - Includes a leading `Search` icon, a clear button (`X`, `IconButton` or 44px hit target, visible when `query` is non-empty), and a compact `Ctrl+K` hint button/badge when empty that still opens `CommandPalette`.
   - Shortcut: `Ctrl+Shift+F` (or `/` when not writing) focuses the sidebar search input (opening the mobile sidebar sheet if on mobile).
   - Scope awareness: filters the active view (`notes` or `trash`) and selected group. If the user is in a specific group and 0 notes match there, but matches exist in «همهٔ یادداشت‌ها», the empty state states this and offers a one-click button: «جستجو در همهٔ یادداشت‌ها (N مورد)» (`antislop` R-27).
2. **Highlighted Titles & Match-Centered Snippets in `NoteItem.tsx`:**
   - New lightweight `<HighlightText text={...} ranges={...} />` component that renders matched slices in `<mark className="rounded-[2px] bg-selection text-ink font-medium">`.
   - When a search query is active, `NoteItem` renders `result.snippet` (with ellipsis and `<mark>` highlights) instead of the top-of-note preview, plus a subtle match-count badge (`۳ مورد`) in the metadata row when `bodyMatchCount > 1`.
3. **Command Palette (`CommandPalette.tsx`) Powered by `searchNotes`:**
   - Uses `searchNotes` across all active notes (and trashed notes, labeled «در سطل زباله», ranked below active notes) *before* slicing to the top 12 results, with `<HighlightText>` on both the title and the match-centered hint snippet.

### Phase 3 — In-Note Search & Replace Bar (`EditorSearchBar.tsx`, `Editor.tsx`, `CodeEditor.tsx`)

1. **Surface & Placement (`DESIGN.md` §6):**
   - Floating `glass-panel` bar at the top of the editor sheet (below/aligned with `EditorToolbar`, or expanding cleanly in the top-inline-end zone without stacking glass on glass).
   - Opened by `Ctrl+F` / `Cmd+F` (instant open, `duration: 0`, per `emil-design-eng` & `DESIGN.md` §5), by the new `Search` button in `EditorToolbar`, or automatically when selecting a note from a sidebar/palette search result (pre-filled with the list query, without stealing focus from the list unless the user presses `Enter` or `Ctrl+F`).
2. **Controls & Keyboard Path:**
   - Search `<input>` (`dir={useTextDirection(query)}`, `aria-label="جستجو در متن یادداشت"`).
   - Live counter in Persian numerals (`۲ از ۷` or `۰ مورد` when query is non-empty with no matches, `aria-live="polite"`).
   - Navigation: `Enter` (Next match), `Shift+Enter` (Previous match), `ChevronUp` / `ChevronDown` buttons (36×36 visual, 44×44 touch target).
   - Toggles:
     - **تطابق دقیق (`Aa` / `CaseSensitive`):** toggles exact character & case matching vs. smart Persian normalization.
     - **کلمهٔ کامل (`WholeWord`):** toggles whole-word boundary matching.
     - **جایگزینی (`Replace` toggle, hidden when `isTrash` or `mode === 'preview'`):** reveals the second row with Replace input (`جایگزینی با…`), «جایگزینی» (replace current match and advance), and «همه» (replace all matches in one undoable step via `applyBody`).
   - `Escape`: closes the search bar and returns focus & selection to the active match in the editor (`bodyRef` or `cmRef`). `useKeyboardShortcuts` yields when the search bar handles `Escape` (`e.defaultPrevented`).
3. **Highlighting Across All 3 Editor Modes:**
   - **Default `<textarea>` mode (`Editor.tsx`):**
     - A synchronized `aria-hidden="true"` backdrop layer sharing the exact grid cell, padding (`gutter`), `dir={bodyDir}`, font, and `line-height` of the `<textarea>`.
     - Renders the body text with `color: transparent` and `<mark>` spans for every match (`bg-accent-soft` for inactive matches, `bg-selection ring-1 ring-accent` for the active match).
     - The active `<mark>` is scrolled smoothly into view inside the document scroll container (`scrollIntoView({ block: 'center' })`).
   - **Experimental CodeMirror 6 mode (`CodeEditor.tsx`):**
     - Adds a `StateEffect` + `StateField` decoration extension using `@codemirror/view`'s `Decoration.mark` (already installed, 0 new packages).
     - Styles `.cm-searchMatch` (`background-color: var(--accent-soft)`) and `.cm-searchMatch-selected` (`background-color: var(--selection); outline: 1px solid var(--accent)`).
     - Exposes `setSearch(ranges: MatchRange[], activeIndex: number)` on `CodeEditorHandle`, scrolling the active range into the document scroller's viewport via `view.coordsAtPos`.
   - **Markdown Preview mode (`Editor.tsx`):**
     - A `useLayoutEffect` on the `.markdown-preview` container runs after `renderMarkdown(body)` and walks text nodes (`document.createTreeWalker(el, NodeFilter.SHOW_TEXT)`) to wrap matched ranges in `<mark>` elements without touching `markdown.ts`'s `html: false` + `DOMPurify` XSS boundary.
     - Scrolls the active `<mark>` into view on navigation.
