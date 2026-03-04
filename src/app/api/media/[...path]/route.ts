import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CACHE_DIR = path.join(process.cwd(), 'data', 'media-cache')

const ALLOWED_PAGE_DOMAINS = [
  'hot.planeptune.us',
  'static.comix.to',
  'temp.compsci88.com',
]

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

function getCachePath(url: string): string {
  const hash = createHash('sha256').update(url).digest('base64url')
  const ext = path.extname(new URL(url).pathname) || '.jpg'
  return path.join(CACHE_DIR, `${hash}${ext}`)
}

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true })
  }
}

async function fetchUpstream(
  url: string,
  headers?: Record<string, string>
): Promise<Response> {
  return fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      ...headers,
    },
  })
}

function contentTypeFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const types: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
  }
  return types[ext] || 'application/octet-stream'
}

async function handleCover(id: string): Promise<NextResponse> {
  const upstreamUrl = `https://temp.compsci88.com/cover/fallback/${id}.jpg`

  const res = await fetchUpstream(upstreamUrl)
  if (!res.ok) {
    if (res.status === 404) {
      return NextResponse.json({ error: 'Cover not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Upstream fetch failed' }, { status: 502 })
  }

  const data = await res.arrayBuffer()
  const contentType = res.headers.get('content-type') || 'image/jpeg'

  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    },
  })
}

async function handlePage(url: string | null): Promise<NextResponse> {
  if (!url) {
    return NextResponse.json(
      { error: 'Missing url query parameter' },
      { status: 400 }
    )
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
  }

  if (!ALLOWED_PAGE_DOMAINS.includes(parsed.hostname)) {
    return NextResponse.json({ error: 'Domain not allowed' }, { status: 400 })
  }

  ensureCacheDir()
  const cachePath = getCachePath(url)

  if (existsSync(cachePath)) {
    const data = await readFile(cachePath)
    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': contentTypeFromExt(cachePath),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Cache': 'HIT',
      },
    })
  }

  const res = await fetchUpstream(url, {
    Referer: 'https://weebcentral.com/',
  })

  if (!res.ok) {
    if (res.status === 404) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Upstream fetch failed' }, { status: 502 })
  }

  const data = Buffer.from(await res.arrayBuffer())
  const contentType = res.headers.get('content-type') || contentTypeFromExt(cachePath)

  writeFile(cachePath, data).catch(() => {})

  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Cache': 'MISS',
    },
  })
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params

  if (!segments || segments.length === 0) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  const type = segments[0]

  try {
    if (type === 'cover') {
      const id = segments.slice(1).join('/')
      if (!id) {
        return NextResponse.json(
          { error: 'Missing cover ID' },
          { status: 400 }
        )
      }
      return await handleCover(id)
    }

    if (type === 'page') {
      const url = request.nextUrl.searchParams.get('url')
      return await handlePage(url)
    }

    return NextResponse.json({ error: 'Unknown media type' }, { status: 400 })
  } catch {
    return NextResponse.json({ error: 'Upstream fetch failed' }, { status: 502 })
  }
}
