# DESIGN.md — Tachyon

This is the design's inner monologue. It documents the concept, the
typographic grammar, and the decisions that landed vs. the ones that
didn't — the deep layer for the motivated reader. The artifact itself
should reward curiosity on its own; this is here for the person who
wants to know *why*.

---

## 1. The concept

**Ink & Seal.** Tachyon is a private reading room. Its substrate is
blue-black ink; its single hot note is cinnabar (朱色), the colour of
the personal seal you press onto a page to mark it as yours. Everything
in the app resolves to one of three positions:

- **Ink** — the ground, the typography, the quiet surfaces.
- **Seal** — the cinnabar accent, spent sparingly, always meaningful.
- **Paper** — an off-white warm tone that appears only on the seal itself.

The app is single-user and opinionated. There is no social layer, no
theme picker, no light mode. The reader is the subject; everything else
is furniture arranged around the chair.

---

## 2. Typographic grammar

Three typefaces, each with a job:

| Face | Role | Used for |
|---|---|---|
| **Instrument Serif** | The voice | Page titles, section headings, stat numbers, chapter-transition episode titles, ledger section names |
| **DM Sans** | The workhorse | Body copy, buttons, descriptions, anything that needs to recede |
| **JetBrains Mono** | The instrument | Counts, dates, intervals, keyboard shortcut legends, micro-caps labels, streak figures |

Italic *Instrument Serif* is reserved for quiet subtitles — the whisper
between a heading and its content. This is the voice used on the chapter-
transition screen ("Chapter complete / Episode 157") and then lifted
consistently to the Downloads, Updates, Cache, and Stats subtitles. It's
the one place where the app lets its guard down and *speaks*.

Micro-caps labels use `font-mono`, `text-[10px]`, `uppercase`,
`tracking-[0.18em]`. They mark sections the way printer's rules mark
paragraphs on a broadsheet.

---

## 3. Colour and the cinnabar economy

Cinnabar is precious. It's spent on exactly four things:

1. **You are here** — active tab underline, sidebar active stripe, bottom-tab
   underline, chapter row left-border, selected filter chip.
2. **Fresh content** — unread chapter numbers, unread badges on covers,
   the freshness lamp tier on new chapters (< 4 weeks).
3. **The one primary action** — the single `variant="primary"` button per
   surface (Continue reading, Add to Library, Create rule).
4. **Hover affordance** — links and secondary buttons glow cinnabar on
   hover; this is the one place where it also means "you can press me."

Everything else lives in the text-muted / text-faint / border-subtle
gradient. If cinnabar is on screen in more than ~4 locations, something
has gone wrong.

### The paper-white token

`--color-text-on-accent: #fbf7f5`. This is the warm off-white that
appears *only* on cinnabar fills. The previous design used `text-void`
(near-black) on cinnabar, which made every primary button read like a
warning label. Paper-white makes the same button read as a seal pressed
onto rice paper — which is the metaphor that was supposed to be there
all along.

### Status colours (cool-shifted)

Six status tokens (`reading`, `completed`, `paused`, `dropped`,
`planning`, `rereading`) deliberately pulled cooler than pure primaries
so they don't fight cinnabar. They're used only as status dots, tiny
chips, and occasional text colours on the "what kind of thing is this"
axis — never for main actions.

### Freshness lamp

A four-stage cinnabar fade (`lamp-fresh` → `lamp-warm` → `lamp-fading`
→ `lamp-cool`) maps the age of a chapter's `publishedAt` to a tier.
A small coloured bar on the chapter row — and a matching top-edge
stripe on the cover card — tells you "this is new" without any words.
Past ~4 weeks the lamp goes dark: absence *is* the signal.

---

## 4. The Button primitive

Before: every page re-typed the same `inline-flex items-center gap-1.5
rounded-sm border border-border px-2 py-1.5 text-xs text-text-muted
hover:border-accent hover:text-accent` incantation. Buttons across the
app had subtly drifted in size, spacing, and hover behaviour, which made
any global tonal move impossible.

The primitive at `src/components/ui/button.tsx` exposes five variants,
ordered by weight:

- **primary** — cinnabar fill, paper-white text. ≤1 per surface.
- **seal** — bordered cinnabar text, reads as "the outline of the stamp
  before it lands." Used for headline verbs in a toolbar (Download on
  the series page; New rule on Updates).
- **secondary** — the default. Border + text-muted + cinnabar on hover.
  Carries a `selected` prop that turns it into the highlighted filter
  chip (`border-accent bg-accent-faint text-accent`).
- **ghost** — borderless, text-only. Toolbars, row actions, tight
  chrome. Fades into the background until pressed.
- **danger** — bordered + text-dropped. Reveals the red on hover so it
  doesn't shout while idle but is unmistakable in motion.

Plus `LinkButton` (for Next.js links) and `IconButton` (for icon-only
affordances).

**Primary's single rule:** one per surface. The moment a page has two
primaries, the hierarchy has collapsed — fix the design, don't "just add
another primary."

---

## 5. The Source Label rule

Under every SeriesGridCard the source name used to render in cinnabar,
uppercase, tracking-wide, medium-weight — the single loudest element on
a library page full of manga covers. Source is a catalog note, not a
brand marker.

Two changes:

- The label is now `font-mono`, `text-[10px]`, `lowercase`,
  `text-text-faint`. Legible when you go looking; invisible when you're
  reading the row.
- `showSource` defaults to `true` (useful on search results where source
  does matter at a glance) but the library explicitly passes `false`:
  in your own library, the source is noise.

---

## 6. Page-by-page metaphors

Each surface has a one-line metaphor that the copy and composition
answer to. The metaphor isn't shouted at the user; it's baked into the
subtitle, the empty state, and the layout.

| Surface | Metaphor | Subtitle copy |
|---|---|---|
| Library | The shelf | *(stats line: N series · N reading · N unread)* |
| Series | The catalogue card | author · type · year · updated-phrase |
| Reader | The chair | *(no chrome when reading; serif italic between chapters)* |
| Search | The stacks | *"Browse the stacks"* / *"Or type above to hunt something specific."* |
| Downloads | The queue | *"The queue — what's being fetched from the archives right now."* |
| Updates | Standing orders | *"Standing orders — the rounds your library walks on a timer."* |
| Cache | The drawer | *"The drawer — chapters tucked away for reading without a tether."* |
| Stats | The ledger | *"Your reading, recorded."* |
| Manage | The workshop | *(section-card layout)* |

Empty states follow the metaphor rather than being literal:

- Downloads active empty → *"The queue is quiet."*
- Cache active empty → *"The drawer is closed."*
- Cache library empty → *"Nothing stashed yet."*
- Updates empty → *"No standing orders yet."*
- Library empty → *"An empty shelf. Find something worth stamping onto it."*
- Search no results → *"Nothing by that name."*
- Stats empty → *"A blank page."*

---

## 7. Stats as a ledger, not a dashboard

The earlier Stats page was four bordered metric-cards, four bordered
chart-cards, and a bordered log. That treatment was explicitly rejected
for the library home ("felt corporate, like Grafana") — but Stats had
inherited it anyway.

The new layout removes the box-per-section chrome and lets the page
flow like a broadsheet:

- **Masthead** — a horizontal strip framed by two hairline rules, with
  four running numbers (Chapters read / Streak / Avg / Library). Numbers
  are Instrument Serif 3xl; labels are micro-mono caps; subs are mono.
  Reads like a dateline, not a grid of tiles.
- **InkCalendar** — 30 days of reading as a grid of small tiles,
  opacity scaling on a square-root curve so small values stay legible
  against big bursts. Ink drops on a page.
- **TopShelf** — most-read series as a trophy shelf: tiny cover + title
  + thin cinnabar progress stroke + count. Not a bar chart with a title
  stapled to it; the cover is the bar.
- **TheStack** — status distribution as a ruled list (one row per
  status, thin horizontal bar, count on right). Feels like a library
  sorted into piles.
- **TheWeek** — day-of-week totals, same ruled list format as TheStack.
  "You're a Sunday reader" becomes visible without shouting.
- **TheLog** — recent chapters as a divided list. Series title in
  serif, chapter in mono, time-ago in mono-faint. The most ledger-like
  surface; every other section answers to this one.

Sections are separated by vertical space and typographic rhythm, not
bordered cards.

---

## 8. Shared RunCard primitive

Downloads and Cache both rendered the same 250-line run card with
slightly different variable names — which meant any change had to be
made in three places and usually drifted.

`src/components/run-card.tsx` normalises the data shape (`RunCardData`,
`RunCardTask`, `RunCardActions`) so each page hands over its own run
record (download task, cache task) and renders consistently. Cancel
and retry actions are slots; status labels (queued / running /
caching / cached / done / failed) are passed in. The component has
opinions about the composition (row 1 = identity + status, row 2 =
meta + counters + actions, progress bar at the bottom, expandable
tasks on click) and offers zero configuration over layout, which is
the point.

`RunHistory` is a generic helper for the collapsible "previously
run" list that appears on Downloads, Cache, and (soon) Updates.

---

## 9. Radius, spacing, motion

Tailwind's default `rounded-sm` (2px) is kept as the app's *one*
non-sharp radius — just enough edge-softening to not read as brutal,
but not enough to feel round. Tiny pills and status dots use
`rounded-full`. Nothing uses `rounded-md`, `rounded-lg`, or larger —
those belong to different design languages (SaaS, mobile iOS) and
don't fit Ink & Seal.

Motion is deliberately sparse. The whole app has exactly four named
animations:

- **fade-up-in** (220ms) — the `<main>` reveal on route change.
- **pulse-skeleton** (2s) — loading placeholders.
- **progress-indeterminate** (1.4s) — indeterminate progress bars.
- **ping** (CSS built-in) — the AniList "connection alive" dot.

No hover slides, no float-ups, no parallax. A `prefers-reduced-motion`
block zeroes every duration globally.

---

## 10. What was rejected

- **SaaS-style metric cards on Stats.** Rejected for the same reason
  as on the library home — they felt corporate. The ledger flow is
  the better answer.
- **A radius system with three tiers (0 / 2 / full).** Considered
  committing to `rounded-none` on cards (the stamp metaphor). Rejected
  — the 2px softening already reads close to sharp, and blowing up all
  surface radii would have shipped as a visual bomb with limited
  reward.
- **Icon-only bottom nav on mobile.** Considered as a fix for the
  ugly "Down" label. Kept icon + label for consistency with the rest
  of the nav; renamed the offending tab to "Queue" instead.
- **Showing recent searches on the Search empty state.** Tempting but
  added complexity without a strong reason. The browse stacks carry
  enough weight on their own.
- **A fifth "toggle" button variant.** Folded into `secondary` via
  the `selected` prop. Fewer variants means less drift.

---

## 11. The artifact teaches you about itself

The north star for every decision on this app:

> A stranger examining the source, the structure, or the details
> should be able to reconstruct the reasoning without needing a
> companion explanation.

Every token has a semantic name (`--color-lamp-fresh`, not
`--color-warm-3`). Every metaphor gets a comment at the decision
point, not at obvious lines. Every empty state is voiced so the
quiet room still has a personality when there's nothing in it.

If you look closely, you'll notice things most people won't: the
AniList dot pings because that's the only "connection alive" signal
on an otherwise still page. The freshness lamp disappears past four
weeks because absence *is* the signal. The chapter-transition screen
uses italic serif because that's where the app exhales. These were
all put there on purpose, for you.
