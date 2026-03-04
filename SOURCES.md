# Manga Source Reverse Engineering

Last updated: 2026-03-04

---

## WeebCentral (primary)

**Base URL:** `https://weebcentral.com`  
**Stack:** Server-rendered HTML + HTMX for dynamic loading  
**Auth required:** No (public reading)  
**Rate limiting:** Cloudflare protected — use reasonable delays and a browser-like User-Agent  

### URL Patterns

| Resource | Pattern | Example |
|----------|---------|---------|
| Search page | `GET /search` | Renders search form; results load via HTMX |
| Search data (HTMX) | `GET /search/data?text={query}&sort=Best+Match&order=Descending&display_mode=Full+Display` | Needs `HX-Request: true` and `Referer: https://weebcentral.com/search` |
| Quick search (HTMX) | `POST /search/simple?location=main` | Body: `text={query}`, needs `HX-Request: true` |
| Search by author | Add `&author={name}` to search/data | e.g., `author=ODA+Eiichiro` |
| Search by tag | Add `&included_tag={tag}` to search/data | e.g., `included_tag=Action` |
| Search by type | Add `&included_type={type}` to search/data | e.g., `included_type=Manga` |
| Search by status | Add `&included_status={status}` to search/data | e.g., `included_status=Ongoing` |
| Series detail | `GET /series/{ULID}/{slug}` | `/series/01J76XY7E9FNDZ1DBBM6PBJPFK/One-Piece` |
| Chapter list (HTMX) | `GET /series/{ULID}/full-chapter-list` | Needs `HX-Request: true` header |
| Chapter select (HTMX) | `GET /series/{ULID}/chapter-select?current_chapter={chapterULID}` | Needs `HX-Request: true` header |
| Chapter page | `GET /chapters/{ULID}` | `/chapters/01J76XYYR7FFXEJKK4J072VTM4` |
| Chapter images (HTMX) | `GET /chapters/{ULID}/images?is_prev=False&current_page=1&reading_style=long_strip` | Needs `HX-Request: true` header |
| Series RSS | `GET /series/{ULID}/rss` | `/series/01J76XY7E9FNDZ1DBBM6PBJPFK/rss` |
| Random series | `GET /series/random` | Redirects to a random series page |

### Series IDs

- Uses **ULID** (Universally Unique Lexicographically Sortable Identifier) format
- Example: `01J76XY7E9FNDZ1DBBM6PBJPFK`
- 26 uppercase alphanumeric characters
- The slug after the ULID (e.g., `/One-Piece`) is cosmetic — the ULID is the actual identifier

### Search Parameters

The advanced search page supports these query params (can be combined):

| Parameter | Values | Notes |
|-----------|--------|-------|
| `q` | Free text | Search query |
| `author` | Author name | e.g., `ODA+Eiichiro` |
| `sort` | `Best Match`, `Alphabet`, `Popularity`, `Subscribers`, `Recently Added`, `Latest Updates` | |
| `order` | `Ascending`, `Descending` | |
| `official` | `True`, `False` | Official translation filter |
| `anime` | `True`, `False` | Has anime adaptation |
| `adult` | `True`, `False` | Adult content filter |
| `included_status` | `Ongoing`, `Complete`, `Hiatus`, `Canceled` | |
| `included_type` | `Manga`, `Manhwa`, `Manhua`, `OEL` | |
| `included_tag` | Tag name | e.g., `Action`, `Romance`, `Seinen` |

Available tags: Action, Adult, Adventure, Comedy, Doujinshi, Drama, Ecchi, Fantasy, Gender Bender, Harem, Hentai, Historical, Horror, Isekai, Josei, Lolicon, Martial Arts, Mature, Mecha, Mystery, Psychological, Romance, School Life, Sci-fi, Seinen, Shotacon, Shoujo, Shoujo Ai, Shounen, Shounen Ai, Slice of Life, Smut, Sports, Supernatural, Tragedy, Yaoi, Yuri, Other

### Series Detail Page — Extracted Data

From the HTML of a series page, you can scrape:

```
Title:             <title> tag or main heading
Cover image:       https://temp.compsci88.com/cover/fallback/{ULID}.jpg
Author(s):         Links with href="/search?author=..."
Tags:              Links with href="/search?included_tag=..."
Type:              Link with href="/search?included_type=..."
Status:            Link with href="/search?included_status=..."
Year:              Plain text "Released: YYYY"
Official:          "Official Translation: Yes/No"
Anime:             "Anime Adaptation: Yes/No"
Adult:             "Adult Content: Yes/No"
Description:       Inside a section after "Description"
Related series:    Links to other /series/ pages with relationship labels (Alternate Story, Side Story, Prequel, Spin-Off)
AniList link:      href containing "anilist.co/manga/{anilistId}"
MangaUpdates link: href containing "mangaupdates.com/series/"
```

### Cover Image Pattern

```
https://temp.compsci88.com/cover/fallback/{ULID}.jpg
```

The ULID in the cover URL matches the series ULID. This is a CDN/proxy, not weebcentral's own domain.

### Chapter List

The chapter list is **lazily loaded via HTMX**. The initial series page shows a few chapters, but the full list requires:

```
GET /series/{ULID}/full-chapter-list
Headers: HX-Request: true
         User-Agent: Mozilla/5.0 ...
```

Returns HTML fragments with:
- Chapter links: `href="/chapters/{chapterULID}"`
- Chapter labels: `Chapter {number}` as text content
- Chapters are listed **newest first** (descending)

Example parsed output (alternating lines):
```
/chapters/01KJH7S1BCNVQ4YBA1EV6G2XEA  →  Chapter 1175
/chapters/01KHBJQF3DTD2AEY1P7P857A25  →  Chapter 1174
/chapters/01KGQANRATX8PXAGDFJBA2JJSJ  →  Chapter 1173
```

### Chapter Images

Chapter pages load images **lazily via HTMX**. The initial page HTML includes only a preload hint for the first image. To get all images:

```
GET /chapters/{chapterULID}/images?is_prev=False&current_page=1&reading_style=long_strip
Headers: HX-Request: true
         User-Agent: Mozilla/5.0 ...
```

**Image host:** `https://hot.planeptune.us/manga/`  
**Image URL pattern:** `https://hot.planeptune.us/manga/{Series-Name}/{CCCC}-{PPP}.png`

Where:
- `{Series-Name}` is the series slug with hyphens (e.g., `One-Piece`)
- `{CCCC}` is the zero-padded chapter number (4 digits, e.g., `0003`)
- `{PPP}` is the zero-padded page number (3 digits, e.g., `001`)

Example for One Piece Chapter 3:
```
https://hot.planeptune.us/manga/One-Piece/0003-001.png
https://hot.planeptune.us/manga/One-Piece/0003-002.png
...
https://hot.planeptune.us/manga/One-Piece/0003-022.png
```

**Important:** The image host (`hot.planeptune.us`) may require a `Referer` header set to `https://weebcentral.com/` for access. Always proxy through our server.

### Reading Styles

The chapter page supports multiple reading modes via the `reading_style` parameter:
- `long_strip` — vertical scroll (webtoon-style)
- `single_page` — one page at a time
- `double_page` — side-by-side pages
- `double_page_v2` — alternate double-page layout

### Bookmarks (site-native, not ours)

The site has its own bookmark system via HTMX:
- `POST /chapters/{chapterULID}/bookmarks` — create bookmark
- `DELETE /chapters/{chapterULID}/bookmarks` — remove bookmark

We won't use these; we build our own.

---

## Comix.to (secondary)

**Base URL:** `https://comix.to`  
**Stack:** Next.js (App Router) with React Server Components  
**Auth required:** No for reading, yes for user features  
**Rate limiting:** Cloudflare protected  

### URL Patterns

| Resource | Pattern | Example |
|----------|---------|---------|
| Home | `/home` | Trending, popular, latest updates |
| Series detail | `/title/{hashId}-{slug}` | `/title/0jxn-hajime-no-ippo` |
| Browse | `/browser` | With query params for filtering |
| Browse by type | `/browser?types={type}` | `/browser?types=manga` |
| Browse by genre | `/browser?genres={genreId}` | `/browser?genres=6` |
| Filter page | `/filter` | Advanced filtering |
| Groups | `/groups/popular` | Popular scanlation groups |

### Series IDs

Uses a **short hash ID** system:
- Example: `0jxn` (for Hajime no Ippo)
- Combined with slug: `0jxn-hajime-no-ippo`
- The hash_id is the actual identifier; the slug is for SEO

Internally also uses numeric `manga_id` (e.g., `13621`), but URLs use hash_id.

### Series Data Structure

Comix.to embeds series data directly in the Next.js RSC payload (`self.__next_f`). The manga object contains:

```json
{
  "manga_id": 13621,
  "hash_id": "0jxn",
  "title": "Hajime no Ippo",
  "alt_titles": ["はじめの一歩", "Hajime no Ippo: Fighting Spirit!", ...],
  "synopsis": "...",
  "slug": "hajime-no-ippo",
  "rank": 776,
  "type": "other",                    // manga, manhwa, manhua, other
  "poster": {
    "small": "https://static.comix.to/fb1e/i/e/28/68e095fc59757@100.jpg",
    "medium": "https://static.comix.to/fb1e/i/e/28/68e095fc59757@280.jpg",
    "large": "https://static.comix.to/fb1e/i/e/28/68e095fc59757.jpg"
  },
  "original_language": "ja",
  "status": "finished",               // ongoing, finished, hiatus, canceled
  "final_volume": 0,
  "final_chapter": 0,
  "has_chapters": true,
  "latest_chapter": 1515,
  "chapter_updated_at": 1772580916,    // Unix timestamp
  "start_date": 2008,
  "end_date": "?",
  "created_at": 1758265455,
  "updated_at": 1758735079,
  "rated_avg": 9.4,
  "rated_count": 37,
  "follows_total": 2037,
  "links": {
    "al": "https://anilist.co/manga/30007/",
    "mal": "https://myanimelist.net/manga/7/",
    "mu": "https://www.mangaupdates.com/series/9ft0dv5/"
  },
  "is_nsfw": false,
  "year": 2008,
  "demographic": [{"term_id": 2, "type": "demographic", "title": "Shounen", "slug": "shounen"}],
  "genre": [{"term_id": 6, "type": "genre", "title": "Action", "slug": "action"}, ...],
  "theme": [{"term_id": 45, "type": "theme", "title": "Martial Arts", "slug": "martial-arts"}, ...],
  "author": [{"term_id": 14328, "type": "author", "title": "Morikawa George", "slug": "morikawa-george"}],
  "artist": [{"term_id": 14329, "type": "artist", "title": "Morikawa George", "slug": "morikawa-george"}],
  "_link": "/title/0jxn-hajime-no-ippo",
  "_follows_total": "2,037",
  "_chapter_updated_at": "5 hours"
}
```

### Cover Image Patterns

Three sizes available:
```
Small  (100px): https://static.comix.to/{hash}/i/{path}@100.jpg
Medium (280px): https://static.comix.to/{hash}/i/{path}@280.jpg
Large  (full):  https://static.comix.to/{hash}/i/{path}.jpg
```

### Chapter Loading

**Chapters are NOT in the initial HTML.** They are loaded client-side after hydration. The series page only contains the manga metadata object. Chapters are likely fetched from an internal Next.js server action or RSC endpoint.

**Status: Needs further investigation.** We need to:
1. Monitor network requests on a series page to find the chapter list endpoint
2. Check if there's a paginated API (`/title/{id}/chapters?page=1`)
3. Look at the Next.js RSC flight data for dynamic segment loading

### Chapter Reading

**Status: Not yet investigated.** We need to find:
- How the reader page loads (likely `/read/{hashId}/{chapter}` or similar)  
- Where chapter images are hosted
- Image URL patterns

### Account API Endpoints (discovered in JS bundle)

These internal API routes exist (require auth):
```
/account/bookmarks
/account/export
/account/folders
/account/history
/account/import
/account/info
/account/notifications
/account/ratings
/account/recommendation
/account/update
/account/votes
```

### Browse Parameters

```
/browser?types=manga
/browser?types=manhwa,manhua
/browser?types=manga&year_from=2025
/browser?types=other
/browser?genres={genreId}
/browser?demographics={demographicId}
/browser?authors={authorId}
/browser?artists={artistId}
```

---

## Scraping Strategy

### Priority Order

1. **WeebCentral first** — fully server-rendered, predictable HTML structure, HTMX endpoints for lazy data, straightforward image URLs. Battle-tested CDN for images.

2. **Comix.to later** — richer metadata (ratings, AniList/MAL links built in, poster sizes), but harder to scrape (Next.js RSC payloads, client-side chapter loading). Best used as a metadata enrichment source or fallback.

### Headers Required

Both sites are behind Cloudflare. Always send:
```
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36
```

For weebcentral HTMX endpoints, also send:
```
HX-Request: true
```

### Image Proxying

**Critical:** All manga images must be proxied through our server for:
1. Privacy (reader's IP never touches source CDNs directly)
2. Caching (server-side disk cache for speed + offline)
3. Reliability (if source CDN changes, only proxy layer needs updating)
4. CORS (same-origin for service worker caching)

Image sources discovered:
- **WeebCentral pages:** `https://hot.planeptune.us/manga/...`
- **WeebCentral covers:** `https://temp.compsci88.com/cover/fallback/{ULID}.jpg`
- **Comix.to covers:** `https://static.comix.to/{hash}/i/...`
- **Comix.to pages:** TBD (not yet investigated)

### Rate Limiting Considerations

- Add 200-500ms delays between scraping requests
- Cache aggressively — series metadata rarely changes, chapter lists change daily at most
- Never scrape in tight loops
- Consider caching full chapter lists and only checking for new chapters periodically

---

## Open Questions

- [ ] Comix.to chapter list loading mechanism (client-side RSC fetch? server action?)
- [ ] Comix.to chapter image hosting and URL patterns
- [ ] Whether `hot.planeptune.us` requires Referer header or has other access restrictions
- [ ] Rate limit thresholds for both sources
- [ ] Whether weebcentral search supports pagination (look for `offset` or `page` params)
- [ ] Comix.to search endpoint structure
