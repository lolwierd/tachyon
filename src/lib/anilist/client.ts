const ANILIST_AUTHORIZE_URL = "https://anilist.co/api/v2/oauth/authorize";
const ANILIST_TOKEN_URL = "https://anilist.co/api/v2/oauth/token";
const ANILIST_GRAPHQL_URL = "https://graphql.anilist.co";

export interface AniListConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface AniListTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface AniListViewer {
  id: number;
  name: string;
}

export interface AniListLibraryEntry {
  id: number;
  status: string | null;
  progress: number | null;
  updatedAt: number | null;
  media: {
    id: number;
    title: {
      userPreferred: string | null;
      romaji: string | null;
      english: string | null;
      native: string | null;
    };
  };
}

function requiredEnv(name: "ANILIST_CLIENT_ID" | "ANILIST_CLIENT_SECRET" | "ANILIST_REDIRECT_URI") {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

export function getAniListConfig(): AniListConfig {
  return {
    clientId: requiredEnv("ANILIST_CLIENT_ID"),
    clientSecret: requiredEnv("ANILIST_CLIENT_SECRET"),
    redirectUri: requiredEnv("ANILIST_REDIRECT_URI"),
  };
}

export function isAniListConfigured() {
  return Boolean(
    process.env.ANILIST_CLIENT_ID &&
      process.env.ANILIST_CLIENT_SECRET &&
      process.env.ANILIST_REDIRECT_URI,
  );
}

export function createAniListAuthorizeUrl(state: string) {
  const { clientId, redirectUri } = getAniListConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
  });

  return `${ANILIST_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeAniListCode(code: string) {
  const { clientId, clientSecret, redirectUri } = getAniListConfig();
  const response = await fetch(ANILIST_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
    }),
  });

  if (!response.ok) {
    throw new Error(`AniList token exchange failed (${response.status})`);
  }

  return (await response.json()) as AniListTokenResponse;
}

export async function anilistRequest<T>(
  query: string,
  variables: Record<string, unknown>,
  accessToken: string,
) {
  const response = await fetch(ANILIST_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`AniList request failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    data?: T;
    errors?: { message?: string }[];
  };

  if (!payload.data) {
    const message = payload.errors?.[0]?.message ?? "AniList returned an invalid payload";
    throw new Error(message);
  }

  return payload.data;
}

export async function getAniListViewer(accessToken: string) {
  const payload = await anilistRequest<{ Viewer: AniListViewer }>(
    `
      query Viewer {
        Viewer {
          id
          name
        }
      }
    `,
    {},
    accessToken,
  );

  return payload.Viewer;
}

export async function getAniListMangaLibrary(accessToken: string) {
  const payload = await anilistRequest<{
    MediaListCollection: {
      lists: Array<{
        entries: AniListLibraryEntry[];
      }> | null;
    } | null;
  }>(
    `
      query MangaLibrary($userName: String!) {
        MediaListCollection(userName: $userName, type: MANGA) {
          lists {
            entries {
              id
              status
              progress
              updatedAt
              media {
                id
                title {
                  userPreferred
                  romaji
                  english
                  native
                }
              }
            }
          }
        }
      }
    `,
    { userName: (await getAniListViewer(accessToken)).name },
    accessToken,
  );

  return payload.MediaListCollection?.lists.flatMap((list) => list.entries) ?? [];
}

export async function saveAniListMediaListEntry(input: {
  accessToken: string;
  mediaId: number;
  status: string;
  progress: number;
  entryId?: number | null;
}) {
  const payload = await anilistRequest<{
    SaveMediaListEntry: {
      id: number;
      status: string | null;
      progress: number | null;
      updatedAt: number | null;
    };
  }>(
    `
      mutation SaveMediaListEntry(
        $id: Int
        $mediaId: Int
        $status: MediaListStatus
        $progress: Int
      ) {
        SaveMediaListEntry(
          id: $id
          mediaId: $mediaId
          status: $status
          progress: $progress
        ) {
          id
          status
          progress
          updatedAt
        }
      }
    `,
    {
      id: input.entryId ?? undefined,
      mediaId: input.mediaId,
      status: input.status,
      progress: input.progress,
    },
    input.accessToken,
  );

  return payload.SaveMediaListEntry;
}
