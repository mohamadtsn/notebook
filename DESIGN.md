# DESIGN.md — Notebook Design System

Single source of truth for visual and motion decisions. Every UI change in this repo must be
traceable to a token or rule below. If something isn't covered here, add it here first, then build.

Derived from: `ui-ux-pro-max` (product: *Notes & Writing App*, style: *Glassmorphism + Spatial UI*,
palette: *sage neutral + calm teal*), Apple HIG / *Designing Fluid Interfaces*, and Emil Kowalski's
design-engineering rules.

---

## 0. Principles

1. **Calm over loud.** One accent color. Everything else is neutral. Color carries meaning, never decoration.
2. **The text is the interface.** Chrome recedes; the note is the only thing with full contrast.
3. **Glass means depth, not transparency.** Blur + saturation + a mostly-opaque background. Legibility is never traded for the effect.
4. **Motion explains, it doesn't perform.** If an action happens 50×/day it gets no animation.
5. **Persian-first.** RTL is the default, not an adaptation. Every spacing/border utility is logical (`ps-`, `pe-`, `border-s-`), never physical (`pl-`, `pr-`).

---

## 1. Color

All colors are CSS variables in `src/index.css`, exposed to Tailwind via `@theme inline`.
**Never write a raw hex in a component.**

### Semantic tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--canvas` | `#F5F5F0` | `#131315` | app background (warm paper) |
| `--surface` | `#FFFFFF` | `#1C1C1F` | opaque cards, editor area |
| `--ink` | `#0F172A` | `#EDEDEF` | primary text |
| `--ink-soft` | `#3F4654` | `#C6C6CC` | secondary text, note preview lines |
| `--muted` | `#646B78` | `#8E8E93` | timestamps, placeholders, inactive icons |
| `--accent` | `#0E7490` | `#22B8CF` | active state, focus ring, links, primary action |
| `--accent-soft` | `rgba(14,116,144,.12)` | `rgba(34,184,207,.16)` | active row background, chip fill |
| `--separator` | `rgba(15,23,42,.12)` | `rgba(255,255,255,.14)` | hairlines, dividers, section edges |
| `--scrim` | `rgba(15,23,42,.48)` | `rgba(0,0,0,.62)` | behind every modal layer |
| `--scrollbar` | `rgba(15,23,42,.22)` | `rgba(255,255,255,.18)` | scrollbar thumb (`-hover` variant is darker/lighter) |
| `--destructive` | `#D01E1E` | `#F87171` | delete, error |
| `--success` | `#15803D` | `#4ADE80` | "saved", sync ok |
| `--on-accent` | `#FFFFFF` | `#0B0B0D` | text/icons **on top of** `--accent` (white fails on both accents) |

Tailwind mapping: `bg-canvas`, `bg-surface`, `text-ink`, `text-ink-soft`, `text-muted`,
`bg-accent` / `text-accent` / `text-on-accent`, `border-separator`, `text-destructive`, `text-success`.

### Note label colors

Desaturated pastels. Rendered **only** as a 3px inline-start bar on the note card and a dot in the
picker — never as a card background fill (kills readability, adds visual noise).

| Name | Light | Dark |
| --- | --- | --- |
| `sand` | `#D9C89E` | `#A9955F` |
| `sky` | `#9BBFD4` | `#6E93A8` |
| `sage` | `#A8C2A5` | `#7A9877` |
| `rose` | `#D6AAB2` | `#A87E86` |
| `lilac` | `#B5AECD` | `#8983A3` |

(The old `yellow/blue/green/pink/purple` keys migrate 1:1 to `sand/sky/sage/rose/lilac`.)

### Contrast rules

- Body text on any surface: **≥ 4.5:1**. Muted text: **≥ 4.5:1** (it's still text — `--muted` is chosen to pass, don't lighten it).
- Icon-only controls: **≥ 3:1** against their background.
- Text over a glass layer must be measured against the *worst-case* backdrop (the darkest content that can scroll under it), not against the glass fill.
- Anything drawn on `--accent` uses `--on-accent`, never a literal white: white passes on neither accent (3.68:1 light, 2.38:1 dark).
- Measured ratios against `--canvas` (the tighter of the two backgrounds): muted 4.90, accent 4.90, destructive 4.94, success 4.59. Re-measure before touching any of these four.

---

## 2. Materials (glass)

Three layers. **Never stack glass on glass** — a panel over the chrome uses `--glass-panel` on top
of a *solid* stacking context, or it becomes unreadable.

**Written with Tailwind utilities via `@apply`, never hand-rolled `backdrop-filter`.** Tailwind emits
the composited, prefixed filter chain; a raw declaration duplicates it worse and drops out of the
build's browser targeting. Same rule for the scrim.

| Layer | Where | Utilities (`src/index.css`) |
| --- | --- | --- |
| `chrome` | top bar, sidebar | `bg-surface/80 backdrop-blur-xl backdrop-saturate-150` |
| `panel` | popovers, menus, toolbar pills | `bg-surface/90 backdrop-blur-lg backdrop-saturate-150 shadow-e2` + bright top edge |
| `overlay` | command palette, mobile sheet, dialogs | `bg-surface/95 backdrop-blur-2xl backdrop-saturate-150 shadow-e3` + bright top edge |
| `scrim` | behind every modal layer | `backdrop-blur-sm` + `background: var(--scrim)` |

Shared details:

- **Every layer is tinted from `--surface`, not `--canvas`.** Chrome mixed from `--canvas` sits on a
  `--canvas` page: identical color, so it reads as no layer at all. Surface-tinted chrome reads as a
  plane even where nothing is scrolling underneath to blur.
- **Fill is mostly opaque (80–95%).** Glass here means blur + depth, never see-through.
- **Scrim is not optional and not subtle**: `rgba(15,23,42,.48)` light / `rgba(0,0,0,.62)` dark, plus
  a small blur. A modal without it reads as floating on nothing.
- **Bright top edge** on `panel`/`overlay`: `border-top: 1px solid var(--glass-edge)`. Not on `chrome` —
  the top bar's top edge is the viewport edge, where it does nothing.
- **Section boundaries are explicit.** Navbar gets `border-b`, sidebar `border-e`, the editor sheet a
  full `border` — an app where you can't tell which region you clicked is the bug this fixes.
- **Bigger surface = thicker material**: overlay blurs more and casts a deeper shadow than a toolbar pill.

### Scrollbars

Native scrollbars fight both themes. Global rule in `index.css`: `scrollbar-width: thin`, themed
thumb (`--scrollbar` / `--scrollbar-hover`), transparent track, rounded via a 3px transparent border
with `background-clip: content-box`. **One scroll container per region** — a scrolling wrapper around
a full-height scrolling child produces a scrollbar on empty content.

### Mandatory fallback

```css
@media (prefers-reduced-transparency: reduce) {
  .glass-chrome, .glass-panel, .glass-overlay { @apply bg-surface backdrop-blur-none; }
  .scrim { @apply backdrop-blur-none; }
}
```

No `@supports not (backdrop-filter)` branch: it silently swallowed the design on browsers that do
support the prefixed form, and Tailwind already targets the supported set.

---

## 3. Typography

| Family | Role |
| --- | --- |
| **Geist** (variable) | UI chrome + Latin note body |
| **Geist Mono** | code blocks, inline code |
| **Vazirmatn** (variable) | all Persian text (UI + body) |

`Inter` and `Lora` are removed. Font stack: `'Vazirmatn Variable', 'Geist Variable', system-ui, sans-serif` —
Vazirmatn first so Persian glyphs always come from it, with Geist covering Latin.

### Scale

Tracking is **size-specific** — a single `letter-spacing` value is wrong somewhere.

| Role | Size | Weight | Line-height | Tracking |
| --- | --- | --- | --- | --- |
| Note title (editor) | `1.75rem` | 600 | 1.2 | `-0.02em` |
| Section heading | `1.0625rem` | 600 | 1.35 | `-0.01em` |
| Body / note text | `1rem` | 400 | 1.7 | `0` |
| Note card title | `0.9375rem` | 500 | 1.4 | `0` |
| Caption / timestamp | `0.75rem` | 400 | 1.4 | `+0.01em` |

- Persian text gets `line-height: 1.85` on body (taller ascenders/descenders) — set via `[dir="rtl"]`.
- Spacing in `rem`, never fixed `px` for anything containing text, so OS text-size scaling doesn't break layout.

---

## 4. Space, radius, elevation

- **Spacing scale (4pt)**: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`. Nothing off-scale.
- **Radius**: `--r-sm: 8px` (chips, inputs) · `--r-md: 12px` (buttons, cards) · `--r-lg: 16px` (panels) · `--r-xl: 24px` (overlays, sheets) · `9999px` (pills, segmented control thumb).
- **Elevation** — only three, all soft and low-contrast:
  - `--e-1: 0 1px 2px rgba(15,23,42,.06)` (resting card)
  - `--e-2: 0 8px 32px rgba(15,23,42,.10)` (panel)
  - `--e-3: 0 16px 48px rgba(15,23,42,.18)` (overlay)
- **Touch targets ≥ 44×44px**, ≥ 8px apart. Icon buttons get padding, not a bigger icon.

---

## 5. Motion

Library: [`motion`](https://motion.dev) (the `motion/react` package). CSS transitions for simple
hover/press; springs for anything gesture-driven or interruptible.

### Tokens

```css
--ease-out:    cubic-bezier(.23, 1, .32, 1);     /* enter, most UI */
--ease-in-out: cubic-bezier(.77, 0, .175, 1);    /* on-screen movement */
--ease-drawer: cubic-bezier(.32, .72, 0, 1);     /* sheets */
--d-press: 120ms;  --d-fast: 160ms;  --d-base: 200ms;  --d-slow: 280ms;
```

Spring defaults (motion):

| Interaction | Config |
| --- | --- |
| Default UI | `{ type: 'spring', bounce: 0, duration: 0.35 }` |
| Drag release / sheet | `{ type: 'spring', bounce: 0.2, duration: 0.4 }` |

### Rules

- **Nothing over 300ms** for UI. Exit is faster than enter.
- **`ease-in` is banned** on UI — it delays the frame the user watches most closely.
- **Never animate keyboard-triggered actions.** `⌘K` palette, `⌘N` new note, `Esc` — instant. No exceptions.
- **Never `scale(0)`.** Enter from `scale(.96)` + `opacity: 0`.
- **Popovers scale from their trigger** (`transform-origin` at the trigger), not from center. Modals/palette stay centered.
- **Enter and exit share a path.** A sheet that comes up from the bottom leaves to the bottom.
- Animate **`transform` and `opacity` only**. No `height`/`width`/`margin` animation.
- **Press feedback on pointer-down**: `transform: scale(.97)` over `--d-press`. Never wait for `click`.
- Stagger for list entrances: 30–80ms per item, decorative only, never blocks input.

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 1ms !important; transition-duration: 1ms !important; }
  /* keep opacity cross-fades where they aid comprehension; drop all transform motion */
}
```

Gate hover effects: `@media (hover: hover) and (pointer: fine)`.

---

## 6. Components

**Button** — `--r-md`, 44px min height, `scale(.97)` on `:active`, focus ring `2px var(--accent)` with `2px` offset.
Variants: `primary` (accent fill), `ghost` (transparent, `--accent-soft` on hover), `danger` (destructive text, fill only on confirm).

**Icon button** — 36×36 visual, 44×44 hit area, `--muted` → `--ink` on hover, `--accent` when active. Always has `aria-label` and a tooltip.

**Segmented control** — pill track (`--separator` fill), sliding thumb on `--surface` with `--e-1`. Thumb moves via a layout spring, not a width transition. Used for *نوشتن / نمایش*.

**Note card** — 3px inline-start label bar, title + 2-line preview + timestamp. Active row: `--accent-soft` background + `--ink` title. Hover only under `(hover: hover)`.

**Group row** — a compact row in the sidebar's group strip: the group's 3px inline-start colour bar
(the same treatment the note card uses — never a filled background), name, and a `--muted` count.
Selected row: `--accent-soft` fill + `--ink` name, matching the note card's active state so
"selected" means one thing in this app. Height 36px, hit area ≥44px via padding.

**Group strip** — sits above the note list **inside the sidebar's single scroll container** (§2 —
one scroll container per region; a pinned strip over a scrolling list creates a seam). «همه» is
pinned first and is the default selection. A `+` row at the end opens an inline, already-focused
text input — never a dialog for a one-field create.

**Drop affordance (note → group)** — while a note row is dragged, the group row under the pointer
takes the `--accent-soft` fill and its colour bar goes to `--accent`. No scale, no shadow, no
outline: the fill is the same signal used for "active", and reusing it is what makes the drop
target legible without new vocabulary. Release outside a target springs the row home with
`springDrag`. Desktop only, gated on `@media (hover: hover) and (pointer: fine)` — on touch the
gesture collides with the sidebar sheet's own drag-to-dismiss.

**Toolbar (editor)** — glass `panel` pill floating at the top-inline-end of the editor. Holds the 3–4 frequent actions; everything else lives behind `…`.

**Popover / menu** — solid `--surface` + `--e-2`, not glass. Its trigger usually sits inside a glass surface (the toolbar), and glass-over-glass is banned; small dense text needs the opaque backing anyway. Scales from the trigger edge.

**Select** — the project's own control, never a native `<select>`: the OS widget ignores every
token here (font, radius, popup surface) and renders a light dropdown on a dark page. Trigger is a
`--fill` field with a `--separator` border, `min-height: 44px` (§4), the current value plus a
chevron that rotates 180° on open. The list is a **Context menu** surface anchored under the
trigger's inline-end edge and matching its width, with a `--accent` check on the current row.
It is `position: fixed` **and portalled to `<body>`** — every panel a select appears in is both a
scroll container (which clipped an absolutely-positioned list) and motion-animated, and a transform
makes an ancestor the containing block for `fixed`, which re-based the coordinates onto the panel.

**Context menu** — same material as **Popover / menu** (solid `--surface` + `--e-2`, never glass:
it opens over the editor sheet and dense small text needs opaque backing). Anchored to the pointer
coordinates, scaling from the corner nearest the pointer, and flipped along either axis when it
would overflow the viewport. Opened by `contextmenu` inside the editor, and by `Shift+F10` or the
Menu key anchored to the caret — **a menu reachable only by right-click is not a keyboard path**
(§8). Closes on `Esc`, on a click outside, and on selecting an item; `Esc` returns focus to the
text. Arrow keys move between items; `Home`/`End` jump to the ends. Item rows reuse `PopoverItem`.
Grouped items get a `--separator` hairline between groups, never a heading per group.

**AI result popover** — same material as **Popover / menu** (solid `--surface` + `--e-2`).
Anchored where the context menu was, `max-width: 28rem`, the result in its own scroll container at
`max-height: 40vh` with the note body's type scale and its own `dir` from `useTextDirection` — a
translation into a different script must not inherit the source's direction. Actions, in this
order: **جایگزین کن** (primary), **کپی** (ghost), **دوباره تولید کن** (ghost), **لغو** (ghost).

The result **never** replaces the text on its own; replacement is always an explicit press, and it
goes through the editor's ordinary update path, so it lands in the undo history like any other edit.

Five states, all designed rather than improvised:
- *loading* — a `--muted` caption, no spinner animation over 300ms and no skeleton; the request is
  the wait, not the UI.
- *cache hit* — the result plus a `--muted` «از حافظهٔ محلی» caption. Never hidden: a user who
  expects fresh output must be able to see why it was instant, and reach «دوباره تولید کن».
- *not configured* — a sentence and a button that opens the settings AI section directly.
- *offline / provider error / rate limited* — one plain sentence each, plus «دوباره تلاش کن».
  Never a raw status code or stack trace.
- *empty selection* — the AI rows are not rendered at all in the context menu.

**Native menu escape hatch** — `Shift`+right-click passes straight through to the browser's own
menu. Persian spellcheck suggestions live there, and silently replacing them would be a
regression. The app menu states this at its foot in `--muted` caption text. The app menu also
stands down entirely where its actions cannot apply: preview mode and a trashed note give the
browser menu.

**Command palette** — glass `overlay`, centered, `⌘K`. Searches notes and exposes actions. Opens instantly, no animation.

**Settings overlay** — glass `overlay` (§2) over the mandatory scrim, centered, `--r-xl`,
`max-width: 34rem`, `max-height: min(80vh, 44rem)` with the section list as the single scroll
container (§2 "one scroll container per region"). Opened by `⌘,`, the navbar gear, or the command
palette. Keyboard paths open it **instantly** (§5 — never animate a keyboard-triggered action); a
pointer click gets the standard `popIn` enter from `src/lib/motion.ts`. `Esc` and a scrim click
close it. On open, focus moves to the first control **in the section list** — never the close
button, which would offer leaving as the panel's first statement — and returns to the trigger on
close. Sections are
separated by a `--separator` hairline and a section heading at the §3 "Section heading" size — never
tabs, four sections do not earn tab chrome. It sits over the canvas and its scrim, never over the
navbar's glass: glass over solid, per §2.

**Settings row (Field)** — a label plus an optional one-line description on the inline-start, its
control on the inline-end, `min-height: 44px` (§4 touch floor, not taste), `--separator` hairline
between rows but not after the last. The description is `--muted` at caption size. A row whose
control needs an account shows the sign-in CTA in the control slot; it is **never** rendered
disabled-and-greyed — the row explains what an account adds (PRODUCT.md principle 1). Destructive
rows use the `danger` Button variant, not a red row background. Rows that report live state
(sync status, queue depth) carry `aria-live="polite"`, per §8.

**Toast** — bottom-center (bottom-inline-start on desktop), glass `panel`, enters/exits from the bottom, swipe-to-dismiss with velocity threshold. Destructive actions use an **undo toast**, not a confirm dialog.

**Sheet (mobile sidebar)** — enters from the inline-start edge, `--ease-drawer`, drag-to-dismiss with rubber-banding at the boundary and momentum projection on release.

---

## 7. RTL

- Default direction is `rtl` (`detectDirection` returns `rtl` when text has no strong character).
- Only logical CSS properties: `padding-inline`, `margin-inline`, `border-inline-start`, `inset-inline`, and Tailwind's `ps-/pe-/ms-/me-/start-/end-` utilities. A physical `left`/`right` in a component is a bug.
- Icons that imply direction (back, undo, indent) mirror with the document direction; icons that don't (search, trash, pin) never mirror.
- Title and body carry independent `dir` via `useTextDirection` — one field being English must not flip the other.

---

## 8. Accessibility floor

### Focus

Every focusable thing shows focus — but not all with the same indicator. Three tiers:

| Tier | Indicator | Where |
| --- | --- | --- |
| Default (controls) | `outline: 2px solid var(--accent); outline-offset: 2px` | buttons, links, `[role=button]`, `select`, `[tabindex]` — via a low-specificity `:where(...)` rule in `index.css` |
| Field with its own shape | `ring-2 ring-accent` + `shadow-[0_0_0_4px_var(--accent-soft)]`, opting out with `outline-none` | text inputs whose radius the default outline doesn't flatter (auth form) |
| Lit container | the container's border turns `accent/50` and its shadow lifts, via `focus-within` | the editor sheet — the title and body are the document, and a ring around a page of writing is noise |

Rules:

- **Never a bare `:focus-visible { }` on everything.** It hit the editor's writing surfaces and it
  forced a `border-radius: 4px` that squared off every rounded field.
- **The default rule carries no `border-radius`.** An outline already follows the element's own radius.
- **`outline-none` is only allowed alongside a replacement indicator** from tier 2 or 3.
- The default rule is written with `:where()` (specificity 0) so a component's own indicator wins
  without `!important`.

Non-negotiable, per PR:

- [ ] Text contrast ≥ 4.5:1 in both themes; icon contrast ≥ 3:1
- [ ] Visible focus ring on every interactive element (never `outline: none` without a replacement)
- [ ] Full keyboard path: create, search, navigate list, edit, delete, close
- [ ] `aria-label` on every icon-only control; `aria-live="polite"` on save/sync status
- [ ] `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast` all honored
- [ ] Touch targets ≥ 44×44px
- [ ] No horizontal scroll at 375 / 768 / 1024 / 1440
- [ ] Icons are SVG (lucide) — never emoji

---

## 9. Anti-patterns

| Don't | Do |
| --- | --- |
| Raw hex in a component | semantic token |
| A second accent color | one accent, vary weight/opacity |
| Glass over glass | glass over solid |
| Transparent surface without a blur | blur + mostly-opaque fill |
| `transition: all` | name the properties |
| `ease-in` on UI | `--ease-out` |
| Animating a `⌘K` palette | instant |
| Colored card backgrounds for labels | 3px edge bar |
| Confirm dialog for delete | undo toast |
| `pl-4` / `right-0` | `ps-4` / `end-0` |