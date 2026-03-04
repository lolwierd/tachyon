# Changelog

## Unreleased

### Added

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
