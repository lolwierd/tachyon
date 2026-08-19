# Reader

Private manga/manhwa/comic reader built with Next.js App Router, TypeScript, Tailwind, SQLite, and Drizzle.

## Local development

1. Install dependencies:

	pnpm install

2. Configure environment variables in `.env`:

	- `ANILIST_CLIENT_ID`
	- `ANILIST_CLIENT_SECRET`
	- `ANILIST_REDIRECT_URI`

3. Run dev server:

	pnpm dev

App URL: `http://127.0.0.1:3000`

## Scripts

- `pnpm dev` — start development server
- `pnpm build` — build production app
- `pnpm start` — run production build
- `pnpm lint` — run lint checks
- `pnpm test:run` — run unit/integration tests once
- `pnpm test:e2e` — run Playwright E2E tests
- `pnpm db:generate` — generate Drizzle migrations
- `pnpm db:migrate` — apply migrations

## Offline & PWA

- Service worker is registered automatically in the browser.
- Web manifest is available at `/manifest.webmanifest`.
- Offline cache controls are available on the **Manage** page.
- Chapter pin/unpin and series bulk pin requests are enqueued from each **Series** page.
- Dedicated queue pages are available at **/downloads** and **/updates**.

## Reader Preloading

- The reader preload window is controlled from **Manage** or the in-reader settings and stored in `reader:preload-window`.
- Chapter images now fill the server cache on demand, keeping foreground pages responsive instead of downloading an entire cold chapter in the background.
- Preload concurrency scales with that value: window `N` allows up to `N` concurrent app-driven preloads.
- The reader only preloads up to `N` pages ahead of the current page.
- In vertical mode, app-driven preloads now start **after** the eagerly rendered window so the reader does not compete with itself for the same first pages.
- Vertical mode keeps only a small near-page eager window; farther pages stay lazy/app-preloaded so page 1 does not get buried under a wall of simultaneous image fetches.
- Priority bands also scale from `N`:
  - `high`: the first `ceil(N / 3)` pages ahead
  - `auto`: the remaining pages ahead up to `N`
  - `low`: anything beyond the active preload window
- If you jump around the chapter, stale queued or in-flight app preloads outside that `N` range are canceled so the new nearby pages take over first.
- WeebCentral requests now coordinate shared throttle/backoff state through SQLite so the `reader` and `worker` containers do not independently trigger upstream 429s as easily.
