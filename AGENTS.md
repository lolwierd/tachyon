# AGENTS.md

## Project Overview
- **App**: Reader (private manga/manhwa/comic reading app)
- **Framework**: Next.js App Router (`src/app`) with React + TypeScript
- **Styling**: Tailwind CSS v4
- **Database**: SQLite (`data/reader.db`) via Drizzle ORM
- **Content Source**: WeebCentral scraper in `src/lib/sources/weebcentral.ts`

## Codebase Shape
- `src/app/(main)` — main pages (`/`, `/search`, `/library`, `/series/[id]`)
- `src/app/read/[seriesId]/[chapterId]` — reader UI and keyboard-driven reading flow
- `src/app/api/**` — route handlers for search, series, chapters, media proxy, and reader state
- `src/lib/db/**` — Drizzle schema, DB init, and migrations
- `src/lib/reader/state.ts` — persistence logic for reading progress and preferences
- `src/lib/sources/**` — source integration + parsing types/tests
- `tests/e2e/**` — Playwright E2E tests

## Local Development
- Install deps: `pnpm install`
- Run app: `pnpm dev`
- Lint: `pnpm lint`
- Unit/integration tests: `pnpm test:run`
- Coverage: `pnpm test:coverage`
- E2E: `pnpm test:e2e`
- DB migration generation: `pnpm db:generate`
- Apply DB migrations: `pnpm db:migrate`

## Implementation Conventions
- Keep code in TypeScript with strict typings (`tsconfig` is strict).
- Use `@/*` imports for files under `src`.
- Prefer small, focused changes in existing modules over broad rewrites.
- For API handlers, maintain current error response style (`{ error: string }` + appropriate status).
- For reader behavior changes, preserve keyboard navigation and persisted state semantics.

## Testing Expectations (Important)
- Add **ample tests for every new feature**.
  - Unit tests for logic/parsing/state behavior.
  - Route tests for API contracts and error handling.
  - E2E coverage for user-visible flows when behavior changes.
- After **every code change**, ensure tests pass before considering work complete.
  - Minimum gate: `pnpm test:run`
  - When applicable: also run `pnpm test:e2e`
- Do not merge or finalize changes while tests are failing.

## Database Migrations
- **Single source of truth**: `src/lib/db/migrations/` — do NOT maintain a separate root-level `migrations/` folder.
- Drizzle generates migrations here (`drizzle.config.ts` → `out: "./src/lib/db/migrations"`).
- The Dockerfile copies `src/lib/db/migrations/` → `./migrations` inside the image for runtime use.
- When adding a new migration via `pnpm db:generate`, only `src/lib/db/migrations/` needs updating — no manual syncing required.

## Notes
- Existing unit tests live alongside code as `*.test.ts`/`*.test.tsx`.
- E2E tests assume app server at `http://127.0.0.1:3000` and are configured in `playwright.config.ts`.
