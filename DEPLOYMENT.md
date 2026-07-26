# Deployment

## Production

Tachyon runs on the ARM64 host `miso`:

- Deployment directory: `/home/ubuntu/tachyon`
- Compose file: `deploy/miso/compose.yml`
- Local application endpoint: `http://127.0.0.1:3010`
- Public hostname: `https://tachyon.lolwierd.com`
- Persistent data: Docker volume `tachyon_reader-data`
- Ingress: host Caddy proxies the public hostname to port 3010

Only the Compose file and an untracked `.env` file are stored in the deployment
directory. The private Git repository is not checked out on the server.

## Services

The Compose stack contains:

- `reader`: the web application
- `worker`: background update and download jobs
- `flaresolverr`: Cloudflare challenge helper
- `watchtower`: checks the private GHCR image every 30 seconds

Both application containers share the `reader-data` volume. Port 3010 is bound
to loopback only; Caddy is the only public ingress.

## Configuration

The server-side `/home/ubuntu/tachyon/.env` contains NSFW mode and fresh basic
authentication credentials:

```dotenv
NSFW_ENABLED=1
TACHYON_BASIC_AUTH_USERNAME=reader
TACHYON_BASIC_AUTH_PASSWORD=<generated password>
```

GHCR authentication is stored in `/home/ubuntu/.docker/config.json`. Do not
commit either file.

Caddy has this site:

```caddyfile
tachyon.lolwierd.com {
	import cloudflare
	reverse_proxy 127.0.0.1:3010
}
```

## Initial deployment

From an authenticated workstation:

```sh
ssh miso 'mkdir -p /home/ubuntu/tachyon'
scp deploy/miso/compose.yml miso:/home/ubuntu/tachyon/compose.yml
gh auth token | ssh miso 'docker login ghcr.io -u lolwierd --password-stdin'
```

Create `/home/ubuntu/tachyon/.env` with mode `0600` and the three variables
shown above. Generate a unique password; do not reuse a GitHub or Cloudflare
credential.

Start and verify the application before changing ingress:

```sh
ssh miso 'cd /home/ubuntu/tachyon && docker compose pull && docker compose up -d'
ssh miso 'curl --fail http://127.0.0.1:3010/api/health'
```

Add the Caddy site shown above to `/etc/caddy/Caddyfile`, then validate and
reload:

```sh
ssh miso 'sudo caddy validate --config /etc/caddy/Caddyfile'
ssh miso 'sudo systemctl reload caddy'
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

The proxied Cloudflare `A` record for `tachyon.lolwierd.com` must use Miso's
public origin IP, `141.148.198.58`.

The old `tachyon-ts.lolwierd.com` record points at Kakkoii's Tailscale address
and is not part of this deployment. Miso is currently joined to a different
tailnet, so that record should not be repointed unless the tailnets are first
aligned.

## Rollback

Kakkoii is left untouched during cutover. To roll back, restore the public DNS
origin to Kakkoii. Once Miso is no longer needed:

```sh
ssh miso
cd /home/ubuntu/tachyon
docker compose down
```

Do not add `--volumes` unless the Miso database is intentionally being deleted.
