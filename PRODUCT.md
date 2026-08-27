# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Three audiences, in priority order:

1. **The author, as daily driver.** Uses it as a personal Persian notebook, knows every keyboard
   shortcut, needs no onboarding. Power-user defaults are correct defaults.
2. **Persian-speaking general users.** Want a private, offline notes app in their own language.
   They arrive without instruction, so the interface has to be discoverable and forgiving on first
   run even though audience 1 never needs that.
3. **Developers and designers evaluating craft.** The project doubles as a portfolio piece; the
   quality of the interface is part of what is being shown.

These pull against each other in one predictable place: audience 1 wants density and speed,
audience 2 wants guidance. Resolve it with progressive disclosure, not with a beginner mode.

## Product Purpose

A notebook (دفترچه) that is fully usable with no account and no network. Notes live in the browser;
an optional Fastify/SQLite backend syncs them across devices for users who opt in. Success is that
a user can open it, write, close the tab, and find the note again — without having signed up for
anything, and without RTL text ever having looked like an afterthought.

## Positioning

Four claims, all currently true in the code and all of which future work must keep true:

- **Persian-first RTL, detected per field.** Direction is resolved separately for a note's title and
  its body, and defaults to `rtl` when text has no strong character. Competing notes apps treat RTL
  as a global toggle or lean on `dir="auto"`, which only inspects the first strong character of a
  whole value.
- **Offline-first, sync opt-in.** Local writes never wait on the network. With no account the app is
  entirely local; signing out clears the token and keeps every local note.
- **Small verified surface.** Markdown rendering, direction detection, and storage are hand-rolled
  and covered by `src/utils/checks.ts` rather than delegated to a dependency tree. The markdown
  renderer is escape-first and URL-allowlisted by design.
- **The feel of the interface is the product.** Glass/spatial materials, spring motion, keyboard-first
  operation. This is a stated differentiator, not decoration.

## Operating Context

- Runs in the browser as an installable PWA (precached shell, update-on-demand that never reloads
  mid-sentence). Used on both desktop and phone.
- Typical session is short and interruptive: open, capture or reread one note, leave. Editing
  auto-saves on a 500ms debounce; there is no explicit save action.
- Notes are searched and reached through a `⌘K` command palette as often as through the sidebar list.
- Self-hosted deployment: Docker Compose, Nginx serving the built frontend, SQLite on a host bind
  mount deliberately chosen over a docker volume so no docker command can wipe the file.

## Capabilities and Constraints

Confirmed capabilities: create / edit / pin / color-label notes, soft delete with a trash view and
undo, permanent delete, markdown preview, dark mode, keyboard shortcuts, command palette, PWA
install, optional account-based sync with last-write-wins merge and tombstones.

Durable constraints:

- **Every feature must degrade to a fully local, accountless experience.** Sync stays opt-in; nothing
  may require a backend to be usable.
- Soft delete is the model: notes are stamped `deletedAt`, never removed, except by `permanentDelete`.
- Cross-user isolation on the server comes from filtering every sync statement on the token's
  `user_id` — never on client input.

Current practice, explicitly **negotiable** (the user declined to fix these):

- All user-facing copy is Persian today, with no i18n layer. A future language switcher is open.
- No new runtime dependencies has been the habit, not a rule. New deps are allowed with a reason.

## Brand Commitments

Name: **Notebook** / **دفترچه**. No logo, wordmark, or brand assets exist yet — do not invent one and
present it as established.

## Evidence on Hand

- `DESIGN.md` — the incumbent design system: tokens, glass materials, type scale, motion, component
  specs, RTL rules, accessibility floor, anti-patterns. It is real, current, and authoritative.
- `README.md` — accurate local and production setup.
- `src/utils/checks.ts` — runnable assertions for the markdown and merge invariants.
- No users, testimonials, install counts, benchmarks, press, or pricing exist. There is no revenue
  model. Future work must not fabricate any of these.
- `CLAUDE.md` references `PLAN-V2.md` and `PLAN.md`; **neither file exists in the repo.** Do not cite
  them as a roadmap.

## Product Principles

1. **Local first, always.** The network is an enhancement. A feature that only works signed in is a
   feature designed wrong.
2. **RTL is the default, not the fallback.** Logical CSS properties only; a physical `left`/`right` is
   a bug, not a style choice.
3. **The text is the interface.** Chrome recedes; the note carries full contrast.
4. **Undo over confirm.** Reversible actions happen immediately with an undo toast. Only genuinely
   irreversible ones ask.
5. **Craft is the differentiator, so craft is a requirement.** This is the portfolio surface — the
   accessibility floor and motion rules in `DESIGN.md` are non-negotiable, not aspirations.

## Accessibility & Inclusion

Persian/RTL correctness is a primary accessibility concern here, not an i18n nicety. Beyond that,
`DESIGN.md` §8 sets the floor: 4.5:1 text contrast in both themes, visible focus on every interactive
element, a full keyboard path, `aria-label` on icon-only controls, and honored `prefers-reduced-motion`,
`prefers-reduced-transparency`, and `prefers-contrast`.
