const READER_SEGMENT_PREFIX = "~";
function encodeBase64Url(value: string) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  if (typeof Buffer !== "undefined") {
    return Buffer.from(padded, "base64").toString("utf8");
  }

  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeReaderSegment(value: string) {
  return `${READER_SEGMENT_PREFIX}${encodeBase64Url(value)}`;
}

export function decodeReaderSegment(value: string) {
  if (!value.startsWith(READER_SEGMENT_PREFIX)) {
    return value;
  }

  return decodeBase64Url(value.slice(READER_SEGMENT_PREFIX.length));
}

export function buildSeriesHref(seriesId: string, source?: string | null) {
  const params = new URLSearchParams();
  if (source) {
    params.set("source", source);
  }

  const query = params.toString();
  return query ? `/series/${seriesId}?${query}` : `/series/${seriesId}`;
}

export function buildSeriesApiPath(seriesId: string, source?: string | null) {
  const params = new URLSearchParams();
  if (source) {
    params.set("source", source);
  }

  const query = params.toString();
  return query ? `/api/series/${seriesId}?${query}` : `/api/series/${seriesId}`;
}

export function buildCoverSrc(coverUrl: string, source?: string | null): string {
  const qs = new URLSearchParams({ url: coverUrl });
  if (source) qs.set("source", source);
  return `/api/media/page?${qs.toString()}`;
}

export function buildReaderHref(seriesId: string, chapterId: string, source?: string | null) {
  const path = `/read/${encodeReaderSegment(seriesId)}/${encodeReaderSegment(chapterId)}`;
  if (!source) {
    return path;
  }

  const params = new URLSearchParams();
  params.set("source", source);
  return `${path}?${params.toString()}`;
}
