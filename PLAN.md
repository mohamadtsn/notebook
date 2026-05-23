# Notebook App — Project Plan

## Overview

A single-page, minimal notebook app built with React + TypeScript. Notes are stored in `localStorage`. The UI is clean, fast, and distraction-free — with full support for both RTL (Persian) and LTR (English/etc.) text, detected automatically per field.

---

## Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | **React 19 + Vite** | Fast dev server, modern JSX transform, great ecosystem |
| Language | **TypeScript** | Type-safe props/state/storage, catches bugs early, better DX |
| Styling | **Tailwind CSS v4** | Utility-first, no context switching, easy dark mode |
| Icons | **Lucide React** | Lightweight, consistent icon set |
| Editor | **Plain `<textarea>`** | Zero deps, fast, no bundle overhead |
| State | **useState + useReducer** | Simple enough — no external store needed |
| Persistence | **localStorage** | Zero setup, works offline, enough for now |

> **Future upgrade path:** swap localStorage with a Supabase/PocketBase backend when sync across devices is needed. The `storage.ts` abstraction makes that a one-file change.

---

## Features

### MVP (Phase 1)
- [x] Create new note
- [x] List all notes in sidebar
- [x] Select and view a note
- [x] Edit note title and body inline
- [x] Auto-save on every keystroke (debounced 500ms)
- [x] Delete note (with confirmation)
- [x] Note timestamps (created at, updated at)
- [x] Empty state when no notes exist
- [x] Fully responsive (mobile + desktop)
- [x] **Auto text direction** — RTL/LTR detected per field on each keystroke

### Phase 2 — Polish
- [ ] Search / filter notes by title or content
- [ ] Sort notes: newest first / alphabetical
- [ ] Dark mode toggle (persisted in localStorage)
- [ ] Keyboard shortcuts (`Ctrl+N` new note, `Ctrl+K` search, `Escape` deselect)
- [ ] Character/word count in editor footer
- [ ] Note color labels (5–6 preset colors)

### Phase 3 — Nice to Have
- [ ] Markdown rendering with live preview toggle
- [ ] Export note as `.txt` or `.md`
- [ ] Pin important notes to top
- [ ] Trash / soft-delete with restore

---

## UI Layout

```
┌─────────────────────────────────────────────────────┐
│  NAVBAR: App title                    [+ New Note]   │
├─────────────────┬───────────────────────────────────┤
│                 │                                    │
│  NOTE LIST      │  EDITOR AREA                       │
│  ─────────      │  ──────────                        │
│  [Search box]   │  [Editable title — dir=auto]       │
│                 │                                    │
│  • Note title   │  [Editable textarea — dir=auto]    │
│    2 min ago    │                                    │
│                 │                                    │
│  • Note title   │                                    │
│    Yesterday    │                                    │
│                 │                                    │
│  • ...          │  ─────────────────────────────     │
│                 │  123 words · Updated 2 min ago     │
└─────────────────┴───────────────────────────────────┘
```

- Sidebar: fixed width on desktop (`280px`), slide-in drawer on mobile
- Editor: full remaining width, no toolbar clutter
- Font: `Inter` for UI + `Lora` for note body (readable, warm)

---

## Project Structure

```
notebook/
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── src/
│   ├── main.tsx
│   ├── App.tsx                   # Root layout + state
│   ├── types/
│   │   └── note.ts               # Note interface + shared types
│   ├── hooks/
│   │   ├── useNotes.ts           # CRUD + localStorage logic
│   │   ├── useDebounce.ts        # Debounce hook for auto-save
│   │   └── useTextDirection.ts   # RTL/LTR detection hook
│   ├── components/
│   │   ├── Sidebar.tsx           # Note list + search
│   │   ├── NoteItem.tsx          # Single note card in list
│   │   ├── Editor.tsx            # Title + body editor
│   │   ├── EmptyState.tsx        # Shown when no note selected
│   │   └── Navbar.tsx            # Top bar
│   └── utils/
│       ├── storage.ts            # localStorage get/set abstraction
│       └── direction.ts          # detectDirection() pure function
```

---

## Data Model

```ts
// src/types/note.ts

export interface Note {
  id: string;           // uuid v4
  title: string;
  body: string;
  createdAt: number;    // Unix ms
  updatedAt: number;
  color: NoteColor | null;   // Phase 2
  pinned: boolean;           // Phase 3
}

export type NoteColor = 'yellow' | 'blue' | 'green' | 'pink' | 'purple';

// localStorage key: "notebook_notes" → JSON array of Note[]
```

---

## Auto Text Direction

### Strategy

The HTML `dir="auto"` attribute on a `<textarea>` lets the browser detect direction — but it only looks at the **first strong character** in the entire value. This breaks for mixed-content notes where the first line is in one language and the rest in another.

Instead, we detect direction **per paragraph / per field** ourselves:

```ts
// src/utils/direction.ts

const RTL_REGEX = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

export function detectDirection(text: string): 'rtl' | 'ltr' {
  // Find the first "strong" character (letter) in the string
  for (const char of text) {
    if (RTL_REGEX.test(char)) return 'rtl';
    if (/[a-zA-Z]/.test(char)) return 'ltr';
  }
  return 'rtl'; // default to RTL for Persian-first app
}
```

### `useTextDirection` hook

```ts
// src/hooks/useTextDirection.ts

export function useTextDirection(text: string): 'rtl' | 'ltr' {
  return useMemo(() => detectDirection(text), [text]);
}
```

### Usage in Editor

```tsx
// Title and body each have independent direction
const titleDir = useTextDirection(title);
const bodyDir  = useTextDirection(body);

<input  dir={titleDir} value={title} onChange={...} />
<textarea dir={bodyDir} value={body} onChange={...} />
```

This means:
- A Persian title + English body → each field gets its own direction
- Typing switches direction the moment the first strong character changes
- No flicker, no toggle buttons, fully automatic

### Font handling for RTL

When direction is RTL we switch the body font to a Persian-friendly stack:

```ts
const bodyFont = bodyDir === 'rtl'
  ? '"Vazirmatn", "Tahoma", sans-serif'   // clean Persian sans-serif
  : '"Lora", "Georgia", serif';           // warm Latin serif
```

We'll load `Vazirmatn` from Google Fonts — it's the best open-source Persian font, designed specifically for UI and reading.

---

## Auto-Save Strategy

1. User types in title or body → triggers React state update
2. `useDebounce(value, 500)` waits 500ms after last keystroke
3. Debounced value change fires `saveNote()` → writes to localStorage
4. Visual indicator: `Saving…` → `Saved` in editor footer

---

## TypeScript Notes

- All component props typed with `interface` (not `type` aliases for objects)
- `useNotes` returns a typed object: `{ notes: Note[], activeNote: Note | null, ... }`
- `storage.ts` uses generics: `getItem<T>(key: string, fallback: T): T`
- No `any` — use `unknown` + type guards if needed at JSON parse boundaries
- `tsconfig.json` with `strict: true` from the start

---

## Design Tokens (Tailwind custom theme)

```js
colors: {
  paper:   "#FAFAF8",   // warm off-white background
  ink:     "#1A1A1A",   // near-black text
  muted:   "#8C8C8C",   // timestamps, placeholders
  accent:  "#4F46E5",   // indigo — buttons, active state
  border:  "#E5E5E0",   // subtle dividers
}
```

Font pairing:
- UI chrome → `Inter` (neutral, system-like)
- Note body LTR → `Lora` (serif, warm, comfortable for long reading)
- Note body RTL → `Vazirmatn` (clean Persian, great for both UI and body text)

---

## Setup Commands

```bash
npm create vite@latest notebook -- --template react-ts
cd notebook
npm install
npm install -D tailwindcss @tailwindcss/vite
npm install lucide-react
npm install uuid
npm install -D @types/uuid
```

---

## Suggestions Added

1. **TypeScript strict mode from day one** — catching type errors early is far cheaper than adding types to a large JS codebase later.

2. **`useNotes` custom hook** — keeps all CRUD + persistence in one place. Makes it trivial to later swap localStorage for an API.

3. **Debounced auto-save** — better UX than a Save button. Users expect notes apps to just save.

4. **Optimistic UUID generation** — generate IDs on the client with `uuid`, so note creation is instant.

5. **`storage.ts` generic abstraction** — wraps `localStorage` with type safety. One change here = swap backend later.

6. **Per-field RTL/LTR detection** — smarter than `dir="auto"`. Each field (title, body) detects independently based on first strong character.

7. **Vazirmatn for Persian text** — automatically applied when RTL is detected. No manual switching, no extra UI.

8. **Default direction → RTL** — since the app is likely used primarily in Persian, RTL is the default when no strong character is found yet.

9. **Keyboard shortcuts from Phase 2** — `Ctrl+N` for new note. Low effort, high impact.

10. **Word count in footer** — writers love this. Two lines of code.

---

## Implementation Order

1. Scaffold project + TypeScript config + install dependencies
2. Define `Note` type in `src/types/note.ts`
3. Build `storage.ts` + `direction.ts` utils
4. Build `useDebounce`, `useNotes`, `useTextDirection` hooks
5. Build layout shells: `Navbar` + `Sidebar` + `Editor`
6. Wire up: note list → select → edit → auto-save → direction
7. Add create + delete
8. Style everything with Tailwind + load fonts
9. Add search (Phase 2)
10. Add dark mode toggle (Phase 2)
11. Add keyboard shortcuts (Phase 2)

---

*Plan updated: 2026-05-24 — TypeScript + auto text direction added*