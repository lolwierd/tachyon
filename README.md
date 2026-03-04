# Reader

Private manga/manhwa/comic reader built with Next.js App Router, TypeScript, Tailwind, SQLite, and Drizzle.

## Local development

1. Install dependencies:

	pnpm install

2. Configure environment variables in `.env`:

	- `ANILIST_CLIENT_ID`
	- `ANILIST_CLIENT_SECRET`
	- `ANILIST_REDIRECT_URI`
	- `CF_TUNNEL_TOKEN` (only needed for Docker + Cloudflare Tunnel)

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
- Chapter pin/unpin and series bulk pin are available on each **Series** page.

## Backend deployment (Docker + Cloudflare Tunnel)

This deployment mode runs:

- `reader` app container
- `cloudflared` tunnel container

### 1) Create your Cloudflare Tunnel

In Cloudflare Zero Trust:

- Create a tunnel and copy its token.
- Add a public hostname route (for example `reader.yourdomain.com`) pointing to `http://reader:3000`.

### 2) Set environment values

Set these in `.env` on your backend host:

- `CF_TUNNEL_TOKEN=<token from Zero Trust>`

### 3) Start services

Build and run with Docker Compose:

docker compose up --build -d

Stop:

docker compose down

Notes:

- Persistent SQLite/media data is stored in the `reader-data` Docker volume mounted at `/app/data`.
- `.env` is loaded via `docker-compose.yml`.
- The app does not publish a host port in this compose setup; public access goes through Cloudflare Tunnel.
