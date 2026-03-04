# DESIGN.md — Home & Manage Redesign

## The Concept

The library is a **personal shelf** — not a dashboard. Dashboards show you metrics. Shelves show you *your things*. The old design treated insights (unread, stalled) as separate dashboard zones that created visual noise and duplicated information already present in the library itself. The new design collapses everything into the shelf metaphor: tabs are shelves, the library is the content, and smart filters (Unread, Stalled) are just specialized shelves that surface automatically.

The manage page is a **workshop** — a quiet room adjacent to the shelf where you organize the containers themselves. Previously flat and sparse, now each section is a discrete card, like a workbench with tools laid out.

## The Hook

**Collection tabs as shelves.** Instead of burying collections inside filter chip sprawl, collections are promoted to first-class tab navigation. "All | Unread | Stalled | [Your Collections]..." — a single horizontal line that replaces three separate UI zones (attention feed, filter chips, full library heading). Smart tabs appear and disappear based on your reading state: "Stalled" only shows if you have stalled series, "Unread" only if there's something new. Your collections always show.

## Typography

Unchanged from Ink & Seal. Instrument Serif for page titles and section headers (the display voice), DM Sans for body text and UI chrome (the workhorse), JetBrains Mono for all data — counts, dates, stats strip. The stats strip next to the "Library" heading (`42 series · 18 reading · 137 unread`) is pure mono, deliberately small (11px), positioned as a quiet informational aside that doesn't compete with the display title.

## Color

Same Ink & Seal palette. The active tab underline uses cinnabar accent (#c94a3a), creating a single hot stripe against the cool blue-black. The filter button glows accent-faint when active filters are applied — the only color call-to-action in the toolbar, drawing attention to "you're seeing a subset." AniList connected state uses the completed green with a ping animation — a living indicator.

## Layout Rationale

### Home Page
- **Header**: Title left, stats right. Asymmetric tension. The serif "Library" anchors; the mono stats provide density without clutter.
- **Momentum rail**: Kept as-is — it's genuinely different from the library (horizontal scroll, reader-linking). Now labeled "Pick up where you left off" instead of "Continue reading" — more conversational, implies momentum.
- **Tab bar**: Replaces the old 3-zone architecture. Full-width, horizontally scrollable on mobile (overflow with -mx trick). Each tab shows its count in accent-colored mono beside the label. Active tab has a 2px cinnabar underline. This single row replaces: the attention feed, the collection filter chips, and part of the status filter chips.
- **Toolbar**: Sort dropdown + filter toggle + view toggle. The filter toggle is a compact "Filter" button that expands a row below when clicked, containing status and tag dropdowns. This progressive disclosure means most users see a clean toolbar, power users can dig in.
- **Empty states**: Contextual messaging — "This shelf is empty" for empty collection tabs, "No series match these filters" when filters yield nothing, with a "Clear filters" action.

### Manage Page
- **SectionCard wrapper**: Each section (AniList, Collections, Tags) gets a bordered card with surface background and 20px padding. Creates visual containment.
- **AniList**: Connected state shows a status strip (green pulsing dot + username + linked count + last sync date) inside a raised surface. Action buttons have icons. Disconnected state is a horizontal card with a link icon placeholder.
- **Collections**: Create form above the list. Each collection row reveals edit/delete on hover (opacity transition), keeping the default view clean. Edit mode swaps inline to a raised-bg row with check/X icon buttons instead of text "Save/Cancel".
- **Tags**: Color picker replaced with a preset palette (8 swatches matching the design system + custom picker fallback). Tags grouped by type with small uppercase labels, creating a categorical index. Same hover-reveal edit pattern as collections.

## What Was Rejected

- **Accordion sections for manage page**: Considered collapsing sections. Rejected because with only 3 sections, the overhead of expand/collapse gestures isn't justified — it hides content for no density gain.
- **Dashboard-style stats cards at top of home**: Considered a row of metric cards (total series, reading, completed, etc.). Rejected — felt corporate, like Grafana. The mono stats strip achieves the same information in one line without the visual weight of cards.
- **Keeping the attention feed as a separate zone**: The old unread/stalled dual-column was the main UX complaint. It duplicated library data, created a "what am I looking at?" moment, and pushed the actual library below the fold. Tabs absorb this cleanly.
- **Multi-select filter chips for status**: The old approach showed 6 status chips always visible. Most users filter by one status at a time. A single dropdown is more compact and equally functional. The tab system handles the most common filtered views (Unread, Stalled) without needing chips at all.

## Tone & Texture

The redesigned pages feel like **a well-labeled filing system in a dark room** — you can find things by feel. The tab bar is the primary spatial organizer, anchor for the eye. The momentum rail is the one piece of warmth — horizontal, scrollable, cover-art-forward. Everything else is typographic hierarchy and quiet surfaces.

The manage page feels like opening a drawer: contained, organized, everything in its slot. The hover-reveal edit buttons are a small pleasure — the interface respects your reading mode by hiding chrome until you need it.

## Small Details

- Tab count numbers shift to accent color when active — a micro-detail that reinforces "this is where you are"
- The filter button shows a tiny pill badge with the number of active filters when expanded — borrowed from e-commerce filter UX but at thumbnail scale
- AniList green dot has a CSS ping animation — the only ambient motion on the page, signaling "this connection is alive"
- Collection description in manage truncates to one line with text-xs — it exists but doesn't demand attention
- Tag color presets match the design system palette (accent, status colors, text-faint) so user-created tags harmonize with the rest of the UI
