# Reader — Private Manga Reading Sanctuary

## Vision

A private reading sanctuary for manga, manhwa, and comics. It brings together library, reading, offline access, and personal history into one place that feels stable, elegant, and deeply yours.

**Internal mantra:** *Built for return.* Every part of the product should make it easier and more satisfying to come back tomorrow, next week, or next year.

## Product Promises

1. **Living Personal Library** — A home screen centered on momentum: continue reading, unread chapters, smart shelves, custom collections, personal taxonomy.
2. **Sacred Reading** — Immersive reader with instant resume, series-level preferences, bookmarks, notes, clean chapter transitions.
3. **Offline Ownership** — Download/pin chapters for offline reading. Clear local vs remote status. Storage awareness without ugliness.
4. **Long-term Memory** — Activity timeline, reading history, AniList sync, personal notes, bookmarks, private ratings. The app remembers your reading life.
5. **Gentle Intelligence** — Surface what deserves attention from *your own* library. Internal discovery, not external noise.

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Next.js 15 (App Router) | SSR + API routes in one monorepo, self-hostable |
| Language | TypeScript | End-to-end type safety |
| UI | Tailwind CSS + shadcn/ui | Dark, calm, precise aesthetic. Composable primitives |
| Database | SQLite via better-sqlite3 + Drizzle ORM | Single file, easy backup, perfect for single-user |
| Manga Source | WeebCentral (primary), Comix.to (secondary) | Scraping, extensible source system |
| Sync | AniList GraphQL API | OAuth for library import/progress sync |
| Offline | PWA (Service Worker + Cache API + IndexedDB) | Pin/download chapters for offline reading |
| Image Proxy | Server-side disk cache + same-origin URLs | Privacy, reliability, offline support |
| Auth | Simple password-based session | Single-user, self-hosted |
| Deployment | Docker (long-running Node process) | SQLite + filesystem needs persistent runtime |

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Next.js App                │
│                                             │
│  app/                    lib/               │
│  ├── (home)/             ├── db/            │
│  │   └── page.tsx        │   ├── schema.ts  │
│  ├── series/[id]/        │   ├── index.ts   │
│  ├── reader/[chapterId]/ │   └── migrations/│
│  ├── library/            ├── services/      │
│  ├── search/             │   ├── mangadex/  │
│  └── api/                │   ├── anilist/   │
│      ├── chapters/       │   ├── library/   │
│      ├── series/         │   └── media/     │
│      ├── library/        ├── hooks/         │
│      ├── search/         └── components/    │
│      └── sync/                              │
│                                             │
│  /data/                                     │
│  ├── reader.db  (SQLite)                    │
│  └── media-cache/ (chapter images)          │
└─────────────────────────────────────────────┘
```

## Database Schema

### Core
- **series** — title, alt_titles, description, cover, status, content_rating, demographics, year
- **source_mapping** — links series to MangaDex IDs (extensible to other sources)
- **chapter** — series_id, chapter_no, volume_no, title, published_at, sort_key, page_count
- **chapter_page** — chapter_id, page_index, source_url, content_hash

### Library & Organization
- **library_entry** — series_id, status (reading/completed/paused/dropped/rereading/planning), added_at, rating, favorite
- **collection** — user-defined shelves (name, description, icon, sort_order)
- **collection_series** — many-to-many: collection ↔ series
- **tag** — user-defined tags (name, color, type)
- **series_tag** — many-to-many: series ↔ tag

### Reading State
- **reading_progress** — series_id, current_chapter_id, current_page_index, updated_at
- **chapter_progress** — chapter_id, last_page_index, completed, started_at, completed_at
- **series_preferences** — reading_direction, fit_mode, show_ui_chrome (per-series reader settings)

### Memory
- **bookmark** — series_id, chapter_id, page_index, label, created_at
- **note** — series_id, chapter_id (nullable), page_index (nullable), body, created_at
- **activity_event** — type, series_id, chapter_id, payload (json), created_at

### Sync
- **anilist_sync** — series_id, anilist_id, last_synced_at, remote_status, remote_progress
- **sync_log** — direction, status, details, created_at

### Offline/Cache
- **media_cache** — chapter_id, state (missing/partial/ready), bytes, cached_at, path

## Build Phases

### Phase 1: Foundation ✦ (current)
- [x] Project scaffold (Next.js + Tailwind + shadcn/ui)
- [x] Database schema + Drizzle setup (15 tables, migrations)
- [x] WeebCentral scraper (search, series detail, chapter list, chapter pages)
- [x] Image proxy endpoint (`/api/media/[...path]`) with disk cache
- [x] Search page (live search with grid results)
- [x] Series detail page (metadata + chapter list)
- [x] Chapter reader (vertical scroll, keyboard nav, chapter transitions)

### Phase 2: Reader Core
- [ ] Chapter reader page (vertical scroll + paginated modes)
- [ ] Reading progress tracking (auto-save position)
- [ ] Chapter navigation (prev/next)
- [ ] Series-level reading preferences
- [ ] Keyboard shortcuts

### Phase 3: Library
- [ ] Add to library (with status)
- [ ] Library home page (continue reading, recently added, by status)
- [ ] Smart home sections (unread chapters, stalled series, recently completed)
- [ ] Custom collections/shelves CRUD
- [ ] Tags CRUD + assignment
- [ ] Library filters and sorting

### Phase 4: Memory & Personalization
- [ ] Bookmarks (save page positions with labels)
- [ ] Notes (series-level and chapter-level)
- [ ] Activity event logging
- [ ] Reading history timeline view
- [ ] Personal ratings
- [ ] Reading statistics (chapters/day, streaks, monthly summaries)

### Phase 5: AniList Sync
- [ ] OAuth flow
- [ ] Import library from AniList
- [ ] Status sync (bidirectional)
- [ ] Progress sync with conflict resolution
- [ ] Sync status visibility

### Phase 6: Offline & PWA
- [ ] Service worker setup
- [ ] Chapter download (pin for offline)
- [ ] Offline reading from cache
- [ ] Storage management UI
- [ ] Bulk download (volume/series)
- [ ] Auto-cleanup for unpinned cache

### Phase 7: Polish
- [ ] Search within library
- [ ] "Gentle intelligence" home sections
- [ ] Responsive mobile experience
- [ ] Keyboard-driven navigation throughout
- [ ] Loading states, transitions, animations
- [ ] Docker deployment setup

## Design Direction

**Tone:** Quiet confidence. A private study meets collector's shelf meets beautifully maintained reading room.

**Palette:** Dark, warm, precise. Not cyberpunk, not lifeless minimalism. Think: aged paper in low light, muted accent colors, generous spacing.

**Typography:** Clean, readable. Generous line-height. The text should breathe.

**Interaction:** Calm. No bouncy animations. Subtle transitions. The interface should feel *settled*.

**Key screens:**
- **Home** — Momentum-driven. Continue reading hero, then unread, recently added, collections.
- **Library** — Grid/list toggle. Status tabs. Collection sidebar. Rich filters.
- **Series** — Cover art hero. Synopsis. Chapter list. Your notes, bookmarks, history. Status controls.
- **Reader** — Nothing but the content. Minimal chrome. Tap/scroll to read. Swipe/click for chapters.
- **Search** — Clean search with instant results from MangaDex. "Add to library" inline.
