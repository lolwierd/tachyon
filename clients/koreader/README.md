# Tachyon — KOReader plugin

Browse your self-hosted Tachyon manga server from a Kobo (or any KOReader
device), download a chapter, and read it in KOReader's native reader. Talks to
Tachyon's own JSON API — no OPDS, no Suwayomi.

```
tachyon.koplugin/
  _meta.lua   metadata
  api.lua     HTTP client + auth (CF Access service token / basic / none)
  cbz.lua     pure-Lua STORED zip writer (no zlib dependency) — unit-tested
  util.lua    pure helpers (filename/ext/page-ordering) — unit-tested
  main.lua    settings + browse / download / read-sync UI
```

## How it works

1. `GET /api/library` → list of series.
2. `GET /api/series/{id}/chapters?source=` → chapters (with read state).
3. `GET /api/chapters/{chId}/pages?seriesId=&source=` → page list; each
   `imageUrl` is already a relative `/api/media/page?...` path.
4. Each page is fetched via `GET /api/media/page?url=...` and packed into a
   `.cbz` (pages are already-compressed JPEG/WebP, so the archive is STORED —
   no recompression, no native zip lib needed).
5. The `.cbz` is opened in KOReader's reader.

Downloads land in `<koreader-data>/tachyon/<series>/<chapter>.cbz` (configurable).
A chapter already on disk is opened directly instead of re-downloaded.

## Downloading more than one chapter

In a series' chapter list:

- **⬇ Download all chapters** / **⬇ Download unread** — top of the list.
- **Long-press a chapter** — download that chapter and everything newer.

Bulk downloads skip chapters already on disk (so they're resumable) and are
cancellable mid-run by dismissing the progress dialog.

**Concurrency:** pages within a chapter are fetched in parallel. KOReader's HTTP
is blocking and single-threaded, so this uses a pool of forked subprocesses (one
per in-flight page) — fast when Tachyon has the chapter cached locally. Tune it
under **Server settings → Parallel page downloads (1–8, default 4)**; set it to 1
to be gentle on a remote source. If the fork API is ever unavailable, it falls
back to a sequential loop automatically, so downloads can't break.

## Read-progress sync (back to Tachyon)

Reading on the device syncs back to Tachyon via `POST /api/reader/state`:

- **Finish a chapter** (reach the last page) → marked **read**, and Tachyon
  scrobbles it to **AniList**.
- **Close part-way** → **partial progress** (page X of Y) is saved.

Because a Kobo's WiFi is usually off while you read, unsent updates go to an
on-device **outbox** and flush automatically the next time you're online — when
you browse the library, or via **Tachyon Manga → Sync read progress now** (which
shows how many updates are pending). The write needs no special token: Tachyon's
CSRF guard only blocks cross-site *browser* requests, which a Lua client isn't.

## Auth: Cloudflare Access

Tachyon sits behind CF Access, so the plugin authenticates with a **service
token** (machine auth — no browser redirect):

1. Cloudflare Zero Trust → Access → **Service Auth → Service Tokens** → create
   one. Copy the **Client ID** (`...access`) and **Client Secret**.
2. On the Access application protecting your Tachyon hostname, add a policy with
   action **Service Auth** that includes that token.
3. In KOReader: **Menu → Tachyon Manga → Server settings → Authentication → CF
   Access service token**, paste both values.

The secret is stored in plaintext in `settings/tachyon.lua` on the device. Fine
for a personal Kobo; rotate the token in Cloudflare if the device is lost.

Basic auth and "none" (LAN / Tailscale) are also selectable.

## Install

**macOS (for testing):**
```sh
cp -R clients/koreader/tachyon.koplugin \
  ~/Library/Application\ Support/koreader/plugins/
```
Restart KOReader. (On macOS Sequoia, third-party plugins may not load — see
https://github.com/koreader/koreader/issues/14063.)

**Kobo:** copy `tachyon.koplugin/` into `.adds/koreader/plugins/` on the device
(mounted over USB), then eject.

Then: **Menu → Tachyon Manga → Server settings** → set URL + auth → **Test
connection** → **Browse library**.

## Develop / test

The CBZ writer is dependency-free and unit-tested outside KOReader:
```sh
luajit clients/koreader/test/cbz_test.lua
```
Syntax-check everything:
```sh
for f in clients/koreader/tachyon.koplugin/*.lua; do luajit -e "assert(loadfile('$f'))"; done
```
