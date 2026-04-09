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
	- `CF_TUNNEL_TRANSPORT_PROTOCOL` (optional: `auto`, `quic`, or `http2`; default `auto`)
	- `DNS_TOKEN` (optional: Cloudflare DNS edit token for private HTTPS via Traefik DNS-01)
	- `ACME_EMAIL` (optional: contact email for Let's Encrypt)

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
- Opening a chapter now kicks off server-side warming for the chapter image cache, so the media proxy can fill disk cache before later pages scroll into view.
- Preload concurrency scales with that value: window `N` allows up to `N` concurrent app-driven preloads.
- The reader only preloads up to `2N` pages ahead of the current page.
- In vertical mode, app-driven preloads now start **after** the eagerly rendered window so the reader does not compete with itself for the same first pages.
- Vertical mode keeps only a small near-page eager window; farther pages stay lazy/app-preloaded so page 1 does not get buried under a wall of simultaneous image fetches.
- Priority bands also scale from `N`:
  - `high`: the first `ceil(N / 3)` pages ahead
  - `auto`: the remaining pages ahead up to `N`
  - `low`: anything beyond `N` up to `2N`
- If you jump around the chapter, stale queued or in-flight app preloads outside that `2N` range are canceled so the new nearby pages take over first.
- WeebCentral requests now coordinate shared throttle/backoff state through SQLite so the `reader` and `worker` containers do not independently trigger upstream 429s as easily.

## Backend deployment (Docker + Cloudflare Tunnel)

This deployment mode runs:

- `reader` app container
- `worker` background jobs container
- `cloudflared` tunnel container
- `traefik` private Tailscale-only HTTPS proxy

### 1) Create your Cloudflare Tunnel

In Cloudflare Zero Trust:

- Create a tunnel and copy its token.
- Add a public hostname route (for example `reader.yourdomain.com`) pointing to `http://reader:3000`.

### 2) Set environment values

Set these in `.env` on your backend host:

- `CF_TUNNEL_TOKEN=<token from Zero Trust>`
- `CF_TUNNEL_TRANSPORT_PROTOCOL=auto` (recommended default)
- `TAILSCALE_BIND_IP=100.85.14.86` (optional: bind the app directly on the host's Tailscale IP for a private fast path)
- `DNS_TOKEN=<cloudflare dns token>` (required for private HTTPS on the same hostname)
- `ACME_EMAIL=you@example.com` (recommended)

Notes:

- `auto` lets `cloudflared` prefer QUIC and fall back to HTTP/2 if UDP is blocked.
- Set `CF_TUNNEL_TRANSPORT_PROTOCOL=quic` only if your host/network allows outbound UDP on port `7844`.
- Browser-side HTTP/3 is controlled separately in Cloudflare Dashboard → `Speed` → `Settings` → `Protocol Optimization` → `HTTP/3`.
- `TAILSCALE_BIND_IP` exposes the app on `http://<tailscale-ip>:3000` for tailnet-only access while leaving public access on Cloudflare Tunnel.
- `DNS_TOKEN` is mapped to Traefik's `CF_DNS_API_TOKEN` so Traefik can issue a certificate for the private Tailscale path with Cloudflare DNS-01.
- The private Traefik route is defined in `ops/traefik/tailscale.yml` and currently serves both `tachyon.lolwierd.com` and `tachyon-ts.lolwierd.com` on the Tailscale IP.

### 3) Start services

Build and run with Docker Compose:

docker compose up --build -d

Stop:

docker compose down

If you want to deploy the prebuilt GHCR image instead of building locally, use `make`.
That path logs Docker into `ghcr.io` with either:

- `GHCR_TOKEN` from your environment, or
- `gh auth token` from the GitHub CLI

For private package pulls, the token must have `read:packages`.
If your current `gh` session was created with the default scopes, refresh it first:

gh auth refresh -h github.com -s read:packages

Notes:

- Persistent SQLite/media data is stored in the `reader-data` Docker volume mounted at `/app/data`.
- Traefik stores private ACME certificates in the `traefik-certs` Docker volume.
- `.env` is loaded via `docker-compose.yml`.
- Public access still goes through Cloudflare Tunnel.
- If `DNS_TOKEN`, `TAILSCALE_BIND_IP`, and split-horizon DNS are configured, the same hostname can resolve to the Tailscale IP privately while public DNS continues to point at Cloudflare.
- `tachyon-ts.lolwierd.com` is intended as an always-private hostname. Add only private DNS rewrites for it on your tailnet DNS.
