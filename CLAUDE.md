# CLAUDE.md

## Project Overview
- **App**: Reader (private manga/manhwa/comic reading app)
- **Framework**: Next.js App Router (`src/app`) with React + TypeScript
- **Database**: SQLite (`data/reader.db`) via Drizzle ORM
- **Docker**: Production runs via `docker compose`; rebuild with `docker compose build --no-cache && docker compose up -d`

## Database Migrations — Single Source of Truth
- All migrations live in `src/lib/db/migrations/` — this is the **only** migrations folder.
- The Dockerfile copies `src/lib/db/migrations/` into the image as `./migrations`.
- **Never** create or maintain a separate root-level `migrations/` folder.
- When drizzle generates a new migration (`pnpm db:generate`), it goes directly into `src/lib/db/migrations/`. No manual sync needed.
- If a migration number conflicts with one already applied in production, rename it to the next available index and update the journal before deploying.

## Key File Paths
- Schema: `src/lib/db/schema.ts`
- DB init + auto-migrate: `src/lib/db/index.ts`
- Test DB helper: `src/lib/db/test-utils.ts` (reads from `src/lib/db/migrations/` directly)
- Drizzle config: `drizzle.config.ts`

## Development Commands
- `pnpm dev` — run locally
- `pnpm test:run` — unit/integration tests (must pass before finalizing changes)
- `pnpm db:generate` — generate new migration from schema changes
- `pnpm db:migrate` — apply migrations locally

## Runtime env vars
- `RUN_BACKGROUND_WORKER=1` — enables the worker loop in this process (the `worker` container sets this).
- `NSFW_ENABLED=1` — startup kill switch for adult content. When unset or any other value, NSFW-only scrapers (omegascans, madaradex, toonily, oppai, manhwa18, hentai20, theblank) are not registered, `?nsfw=1` on API routes is ignored, the NSFW toggle and "Move to NSFW" affordances are hidden, and `smart_unread` schedules skip adult series. Flip the env and restart the container to toggle.
- `TACHYON_BASIC_AUTH_*` — public-origin basic auth; see `src/lib/server/access.ts`.

## Conventions
- TypeScript strict mode; use `@/*` imports for `src/`.
- Keep changes small and focused. Don't refactor beyond what's asked.
- Add tests for every new feature (unit + route + E2E where applicable).
