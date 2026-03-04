# Ink & Seal — Design System

## The Concept

Your manga collection displayed with the reverence of a gallery catalog and the efficiency of a personal index. Covers are the art — the UI is the gallery wall. The app should feel like opening a well-kept personal archive: everything in its place, nothing shouting, the content always the brightest thing in the room.

The name "Ink & Seal" comes directly from the material reality of the medium. Manga is ink on paper — black lines, varied stroke weights, obsessive craft. And 朱色 (shu-iro, cinnabar red) is the color of the personal seal (印鑑) — the mark you press into a document to say "this is mine." The whole design orbits this: ink-dark surfaces that recede, and a singular red accent that marks ownership, progress, attention.

## The Hook

The library's default view is a **typographic index** — dense rows with tiny cover thumbnails, monospaced chapter progress, colored status dots. It reads like a table of contents to your reading life. Every other manga reader defaults to cover grids. This app treats your collection as a publication about itself — scannable, precise, information-rich. The grid view exists too (for when you want to browse covers as art), but index-first says something about what this app values: your time, your momentum, your return.

## Typography

Three fonts, three voices. None decorative. All earned.

### Instrument Serif — Display
High-contrast serif with editorial weight. The thick-to-thin stroke variation mirrors brush-inked letterforms — there's a direct material connection to manga's medium. Used for page titles, section headings, the chapter transition interstitial in the reader. It says "this is a curated publication" without saying "this is pretentious." The italic is particularly beautiful and gets used for the chapter transition moment.

### DM Sans — Body
Geometric sans with just enough humanist warmth to not feel robotic. Excellent at small sizes, which matters because this UI has a lot of metadata in tight spaces. Handles labels, buttons, descriptions, metadata lines. Chosen over Inter (the old font) because Inter is the "I didn't think about typography" choice of 2020-2026 — it's fine, but it's the design equivalent of a white t-shirt. DM Sans has slightly more personality in its geometry (look at the lowercase 'a' and 'g') while remaining just as readable.

### JetBrains Mono — Data
Monospaced, used for chapter numbers, page counts, timestamps, progress indicators. This is the "catalog index" voice — when you see JetBrains Mono, you're looking at data, not prose. It creates a visual rhythm in the index view where "Ch. 42/180" aligns cleanly across rows. The choice of JetBrains Mono specifically (over Fira Code, Source Code Pro, etc.) is its slightly wider letterforms and excellent legibility at `text-xs`.

## Color

### The Palette Logic

**Blue-black base (void: #07080c → surface: #0d0f16 → raised: #14171f)**
Not generic dark-mode gray. These have a deliberate blue undertone — like the blue-black ink used in professional manga printing. The previous design used warm neutral darks (#0c0c0f → #121217) which is the "cozy cave" approach every dark UI defaults to. The cool shift is subtle but changes the entire emotional register: this feels more like a workspace, an archive, a space of focused attention rather than a lounge.

**Cool text (text: #dfe1ec)**
Slightly blue-shifted off-white instead of the warm #e8e6e1. Reads crisper against the blue-black backgrounds. The muted and faint tiers (#6e7291, #404462) have a lavender quality that connects to the base palette.

**Cinnabar accent (#c94a3a)**
This is the design's point of view. The old warm amber (#d4a053) was pleasant but generic — every "cozy dark UI" uses warm amber or gold. Cinnabar red is:
1. Culturally specific — 朱色 is the color of Japanese personal seals (印鑑), marking ownership. This is YOUR collection.
2. Emotionally active — red against blue-black creates genuine visual tension. It draws the eye without screaming.
3. Functionally clear — accent elements (progress bars, active states, unread indicators, CTAs) are immediately identifiable.

The accent has three tiers: full (#c94a3a) for primary actions and indicators, muted (#a43c2d) for hover states, faint (#251210) for subtle background tints.

**Status colors** are cool-shifted versions of standard status conventions. They're functional, not decorative — they exist so you can scan a library index and instantly see what's active, complete, or stalled.

## Layout & Structure

### Why Sidebar, Not Top Bar
The old design used a fixed top bar, which ate 56px of vertical space on every page. For a manga reader — where the primary activity is vertical scrolling through tall images — that's a meaningful tax on the most precious axis. A sidebar gives that space back. On desktop (md+), the sidebar collapses to 56px (icons only) and expands to 208px on hover or toggle. On mobile, navigation moves to a bottom tab bar in the thumb zone.

### Why No Container Cards as Default
The old design wrapped everything in `rounded-xl border border-border bg-surface p-4`. Cards everywhere. Cards for series, cards for filters, cards for AniList sync, cards for collections, cards for tags. When everything is in a card, nothing is in a card — the containers stop providing information and become visual noise. The new design uses **typography and spacing** for structure. Containers appear only when semantically meaningful: the sidebar, the reader overlay, explicit input groups. Sections are separated by whitespace and heading hierarchy, not boxes.

### Why Library-as-Home
The old splash page ("Reader" title + two buttons) was a dead end. Every returning user clicked through it to reach content. A personal tool you open daily should land you at your content. The new design makes `/` the library with a momentum rail at the top — your recent reads, one tap to resume. Zero-click content on arrival.

### Information Architecture
- **Momentum rail (top):** Horizontal scroll strip of continue-reading items. The gravity well. One tap to resume.
- **Attention feed (middle):** New chapters, stalled series. Compact rows, not cards. High-density, scannable.
- **Full library (bottom):** Index view (default) or grid view. Inline filter chips. This is the "I want to browse" zone.

This is the "hybrid density" approach: dense where it serves speed (momentum rail, index view, attention feed), spacious where it serves immersion (reader, series detail cover section).

## What Was Rejected

### Warm amber continuation
The old accent color (#d4a053) was the obvious choice to keep — it was pleasant, it worked. But "pleasant and works" is the enemy of "specific and memorable." The amber was indistinguishable from dozens of other dark-mode reading apps. Cinnabar is a choice with a reason behind it.

### Glassmorphism
The old nav used `backdrop-blur-xl` with semi-transparent backgrounds. It's a trend that peaked around 2022-2024 and is now the "I'm using Tailwind and saw a tutorial" default. The new design uses flat, opaque surfaces with structure coming from layout and border, not blur effects. The one exception: the reader overlay, where translucency serves a real function (seeing the manga page behind the controls).

### Bento grid / dashboard layout
Briefly considered a dashboard-style home with bento grid sections. Rejected because it overcomplicates what is fundamentally a list-navigation app. You have a list of series. You want to read one. The design should accelerate that, not wrap it in a spatial puzzle.

### Card-heavy layouts
The entire old design was built on cards. Every series, every chapter, every filter section, every management panel — all in rounded-bordered containers. This was the biggest visual problem: when everything has the same visual weight, nothing has visual weight. The new design reserves containers for things that actually need containment (inputs, the sidebar, overlay panels) and lets content breathe through typography and spacing.

### Light mode
Considered and deferred. The app is used for reading manga — a dark-room, focused-attention activity. Dark mode is native to the use case. Light mode would need to be genuinely good (not just "invert the colors"), and that effort is better spent elsewhere right now. The token system is structured to support it later.

## Tone & Texture

This design should feel like a **well-organized personal library run by someone with opinions.** Not warm and cozy (that was the old design). Not cold and clinical (that's a database). Somewhere in between: **precise but not sterile, dense but not cluttered, dark but not gloomy.**

The materiality is ink and paper translated to screen — flat surfaces with subtle depth from border and shadow rather than blur and gradient. The cinnabar accent is the one emotional note: it says "you are here, this is yours, this matters."

The small detail nobody will notice but I put there anyway: the chapter transition zone in the reader uses Instrument Serif italic for the upcoming chapter title. It's the one moment in the entire app where italic appears. It marks a shift — you're crossing a boundary, turning a page. It's a tiny typographic ceremony for a moment of completion.
