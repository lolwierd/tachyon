# Deployment

## Production

Tachyon runs on the ARM64 host `miso`:

- Deployment directory: `/home/ubuntu/tachyon`
- Compose file: `deploy/miso/compose.yml`
- Local application endpoint: `http://127.0.0.1:3010`
- Public hostname: `https://tachyon.lolwierd.com`
- Persistent data: Docker volume `tachyon_reader-data`
- Ingress: the existing Cloudflare Tunnel, protected by Cloudflare Access

Only the Compose file and an untracked `.env` file are stored in the deployment
directory. The private Git repository is not checked out on the server.

## Services

The Compose stack contains:

- `reader`: the web application
- `worker`: background update and download jobs
- `flaresolverr`: Cloudflare challenge helper
- `cloudflared`: connector for the existing Cloudflare Tunnel
- `watchtower`: checks the private GHCR image every 30 seconds

Both application containers share the `reader-data` volume. Port 3010 is bound
to loopback only for host diagnostics; the Tunnel is the only public ingress.

## Configuration

The server-side `/home/ubuntu/tachyon/.env` contains NSFW mode and the existing
Tunnel connector token:

```dotenv
NSFW_ENABLED=1
CF_TUNNEL_TOKEN=<existing tunnel token>
```

GHCR authentication is stored in `/home/ubuntu/.docker/config.json`. Do not
commit either file.

Cloudflare Access protects `tachyon.lolwierd.com`; application basic auth is
not enabled. Miso's host Caddy has no Tachyon site, so the public IP cannot be
used to bypass Access.

## Initial deployment

From an authenticated workstation:

```sh
ssh miso 'mkdir -p /home/ubuntu/tachyon'
scp deploy/miso/compose.yml miso:/home/ubuntu/tachyon/compose.yml
gh auth token | ssh miso 'docker login ghcr.io -u lolwierd --password-stdin'
```

Create `/home/ubuntu/tachyon/.env` with mode `0600` and the two variables shown
above. Copy only the existing Tunnel token; do not copy Kakkoii's complete
environment file.

Start the application without the Tunnel, verify it, and perform the data
migration before cutover:

```sh
ssh miso 'cd /home/ubuntu/tachyon && docker compose pull'
ssh miso 'cd /home/ubuntu/tachyon && docker compose up -d reader worker flaresolverr watchtower'
ssh miso 'curl --fail http://127.0.0.1:3010/api/health'
```

After the migration checks pass, start the connector and stop Kakkoii's
connector:

```sh
ssh miso 'cd /home/ubuntu/tachyon && docker compose up -d cloudflared'
docker compose stop cloudflared
```

## Data migration

Miso started with a fresh SQLite database. The migration from `kakkoii` was
filtered before transmission and retained only:

- series marked `adult`
- their library rows, source mappings, chapters, progress, preferences,
  bookmarks, notes, tags, and download policies

No downloads, media cache, background jobs, settings, non-NSFW library rows, or
other database data were copied.

The allowlist is the intersection of adult series and actual library entries,
not every adult series cached in the database. This is the exact streaming
filter used from Kakkoii; it creates no intermediate backup on Miso:

```sh
docker exec tachyon-reader-1 wget -qO- \
  http://127.0.0.1:3000/api/library/export |
jq '
  .data as $d
  | ($d.libraryEntries | map(.seriesId)) as $libraryIds
  | ([
      $d.series[]
      | select(
          (.adult == true or .adult == 1)
          and (.id as $sid | $libraryIds | index($sid) != null)
        )
      | .id
    ]) as $seriesIds
  | def related:
      .seriesId as $sid | $seriesIds | index($sid) != null;
  ($d.seriesTags | map(select(related))) as $seriesTags
  | ($seriesTags | map(.tagId) | unique) as $tagIds
  | .data = {
      series: ($d.series | map(
        select(.id as $sid | $seriesIds | index($sid) != null)
      )),
      sourceMappings: ($d.sourceMappings | map(select(related))),
      libraryEntries: ($d.libraryEntries | map(select(related))),
      readingProgress: ($d.readingProgress | map(select(related))),
      chapters: ($d.chapters | map(select(related))),
      chapterProgress: ($d.chapterProgress | map(select(related))),
      tags: ($d.tags | map(
        select(.id as $tid | $tagIds | index($tid) != null)
      )),
      seriesTags: $seriesTags,
      bookmarks: ($d.bookmarks | map(select(related))),
      notes: ($d.notes | map(select(related))),
      seriesPreferences: ($d.seriesPreferences | map(select(related))),
      downloadPolicies: ($d.downloadPolicies | map(select(related)))
    }
' |
ssh miso 'curl --fail-with-body --silent --show-error \
  -H "Content-Type: application/json" \
  --data-binary @- \
  http://127.0.0.1:3010/api/library/import'
```

The preflight retained 18 series, 18 source mappings, 18 library entries, 12
reading-progress rows, 1,436 chapters, 474 chapter-progress rows, and 17
download policies. No tags, bookmarks, notes, or per-series preferences were
present for the retained entries.

After import, verify that `/api/library?nsfw=1` contains only the expected
library rows and that `/api/library?nsfw=0` is empty.

## Releases

A push to `main` runs type checking and tests, then publishes a multi-platform
`ghcr.io/lolwierd/tachyon:latest` image for AMD64 and ARM64. Watchtower on Miso
pulls the new image and restarts `reader` and `worker`.

Manual deployment:

```sh
ssh miso
cd /home/ubuntu/tachyon
docker compose pull
docker compose up -d
```

## DNS

No DNS change is required. The existing `tachyon.lolwierd.com` Tunnel route and
Cloudflare Access policy are reused; only the connector host moved. This
requires the same remotely managed Tunnel token and an ingress service of
`http://reader:3000`, both of which were verified after cutover. An
unauthenticated public request must redirect to the Cloudflare Access login.

The old `tachyon-ts.lolwierd.com` record points at Kakkoii's Tailscale address
and is not part of this deployment. Miso is currently joined to a different
tailnet, so remove that record rather than repointing it.

## Rollback

Kakkoii's Docker volume is retained after its containers are stopped. To roll
back, stop the Miso connector first, then restart the Kakkoii Compose stack from
the repository checkout:

```sh
ssh miso 'cd /home/ubuntu/tachyon && docker compose stop cloudflared'
docker compose up -d
```

Kakkoii's retained database is a point-in-time rollback. Reading progress or
library changes made on Miso after cutover must be exported and filtered back
before rollback if they need to be preserved.

Once Miso is no longer needed:

```sh
ssh miso
cd /home/ubuntu/tachyon
docker compose down
```

Do not add `--volumes` unless the Miso database is intentionally being deleted.
