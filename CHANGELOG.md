# Changelog

## Unreleased

### Added

- Structured backend logging in `src/lib/server/log.ts` with route-level error context for search, series, chapter pages, library, collections, tags, and media proxy failures
- Phase 5 AniList sync foundation: OAuth connect/callback flow, persisted AniList account/sync/log tables, library import, bidirectional status/progress sync with merge handling, library/series sync visibility, and API coverage for the new routes
- Full Phase 3 library feature set: add-to-library status flow, library home sections, smart shelves, custom collections CRUD, personal tags CRUD, series assignment for collections/tags, and library filters/sorting
- Reader state API (`/api/reader/state`) with persisted chapter progress and per-series reader preferences
- Reader core persistence in `src/lib/reader/state.ts` for saving current page, completion state, and reading mode preferences against the existing SQLite schema
- Enhanced reader experience with saved resume position, vertical and paged reading modes, fit-width/fit-height/original sizing, and expanded keyboard shortcuts
- Vitest test harness (`vitest.config.ts`, `vitest.setup.ts`) with backend coverage for scraper parsing, utility helpers, and all current API routes
- Playwright end-to-end coverage (`playwright.config.ts`, `tests/e2e/app.spec.ts`) for home navigation, search flow, series detail interactions, and reader progress/preferences behavior
- Project scaffold with Next.js 15 (App Router), TypeScript, Tailwind CSS, and shadcn/ui primitives
- SQLite database via better-sqlite3 + Drizzle ORM with full schema: series, chapters, source mappings, library entries, collections, tags, reading progress, bookmarks, notes, activity events, and media cache (15 tables)
- WeebCentral scraper (`src/lib/sources/weebcentral.ts`) — search, series detail, chapter list, and chapter page extraction with rate limiting and HTMX headers
- Image proxy endpoint (`/api/media/[...path]`) with server-side disk caching for covers and chapter pages, domain allowlisting, and privacy-first same-origin serving
- Search page with live results from WeebCentral in a responsive grid
- Series detail page with cover hero, metadata (status, type, year, authors, tags, AniList link), expandable description, and full chapter list with sort toggle
- Chapter reader with vertical long-strip scroll, keyboard navigation (←/→ for chapters, Esc for UI toggle), chapter transitions, and minimal chrome overlay
- API routes for search (`/api/search`), series detail (`/api/series/[id]`), chapter list (`/api/series/[id]/chapters`), and chapter pages (`/api/chapters/[id]/pages`)
- Core UI components: Nav, SeriesCard, Badge, Input, Skeleton
- Warm dark design system in `globals.css` with custom color tokens (`void`, `surface`, `accent`, `text-muted`, `text-faint`, status colors)
- Home page with quick navigation links
- `PLAN.md` documenting vision, architecture, schema, and phased build plan
- `SOURCES.md` documenting reverse-engineered WeebCentral and Comix.to endpoints, URL patterns, and scraping strategy

### Changed

- `better-sqlite3` is now explicitly allowed in pnpm build dependencies so local installs build the native SQLite binding instead of failing at runtime
- WeebCentral requests now use short-lived response caching, in-flight request deduping, retries for transient upstream failures, and request timeouts to reduce repeated latency and flaky 500s
- Media proxy page allowlisting now accepts `scans-hot.planeptune.us` and related `*.planeptune.us` hosts so reader page images resolve correctly
- Database initialization now lazy-loads `better-sqlite3` so production builds can succeed while keeping Node-only SQLite access on the server
- ESLint ignores now exclude Playwright output directories to keep linting stable after e2e runs
