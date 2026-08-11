import { expect, test, type Page } from "@playwright/test";

const IMAGE_HEADERS = {
  "content-type": "image/png",
};
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sX6ix8AAAAASUVORK5CYII=",
  "base64",
);

async function mockMedia(page: Page) {
  await page.route("**/api/media/**", async (route) => {
    await route.fulfill({
      status: 200,
      headers: IMAGE_HEADERS,
      body: TINY_PNG,
    });
  });
}

test("home page exposes the primary navigation", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.locator('a[href="/search"]').first()).toBeVisible();
  await expect(page.locator('a[href="/manage"]').first()).toBeVisible();
});

test("search page submits a query and renders results", async ({ page }) => {
  await mockMedia(page);
  await page.route("**/api/search?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            sourceId: "series-1",
            title: "Monster",
            slug: "monster",
            coverUrl: "/api/media/cover/series-1",
            year: 1994,
            status: "Complete",
            type: "Manga",
            authors: ["Naoki Urasawa"],
            tags: ["Psychological"],
          },
        ],
        errors: [],
      }),
    });
  });

  await page.goto("/search");
  await expect(page.getByText("Search for manga")).toBeVisible();

  await page.getByRole("textbox").fill("Monster");
  await page.getByRole("textbox").press("Enter");

  await expect(page.getByRole("link", { name: /Monster/i })).toBeVisible();
  await expect(page.getByText("Complete")).toBeVisible();
});

test("search page can include the Mgeko extra provider", async ({ page }) => {
  await mockMedia(page);
  await page.route("**/api/search?*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("showExtra") !== "1") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ results: [], errors: [] }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [
          {
            sourceId: "solo-leveling-mg1",
            title: "Solo Leveling",
            slug: "solo-leveling-mg1",
            coverUrl: "/api/media/cover/solo-leveling-mg1",
            year: null,
            status: "Complete",
            type: "Manhwa",
            authors: ["Sung-Lak Jang"],
            tags: ["Action"],
            source: "mgeko",
          },
        ],
        errors: [],
      }),
    });
  });

  await page.goto("/search");
  await page.getByRole("button", { name: "Show extra providers" }).click();
  await page.getByRole("textbox").fill("Solo Leveling");
  await page.getByRole("textbox").press("Enter");

  await expect(page.getByRole("link", { name: /Solo Leveling/i })).toBeVisible();
  await expect(page.getByText("Complete")).toBeVisible();
});

test("series page renders metadata and lets the reader reorder chapters", async ({ page }) => {
  await mockMedia(page);
  await page.route("**/api/tags", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
  await page.route("**/api/tags/series/series-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tagIds: [] }),
    });
  });
  await page.route("**/api/offline?seriesId=series-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        storage: {
          cacheBytes: 0,
          cachedFiles: 0,
          pinnedBytes: 0,
          pinnedChapters: 0,
        },
        chapters: [],
      }),
    });
  });
  await page.route("**/api/library/series-1", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "Library entry not found" }),
    });
  });
  await page.route("**/api/series/series-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sourceId: "series-1",
        source: "weebcentral",
        title: "Series One",
        slug: "series-one",
        coverUrl: "/api/media/cover/series-1",
        description: "x".repeat(240),
        authors: ["Author One"],
        tags: ["Action"],
        type: "Manga",
        status: "Ongoing",
        year: 2024,
        isAdult: false,
        isOfficial: false,
        anilistUrl: "https://anilist.co/manga/1",
        relatedSeries: [],
      }),
    });
  });
  await page.route("**/api/series/series-1/chapters", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { sourceChapterId: "c1", chapterNo: 1, title: "Chapter 1" },
        { sourceChapterId: "c2", chapterNo: 2, title: "Chapter 2" },
      ]),
    });
  });

  await page.goto("/series/series-1");

  await expect(page.getByRole("heading", { name: "Series One" })).toBeVisible();
  await expect(page.getByText("Author One")).toBeVisible();
  await expect(page.getByText("Action")).toBeVisible();
  await expect(page.getByRole("link", { name: /AniList/i })).toHaveAttribute(
    "href",
    "https://anilist.co/manga/1",
  );

  await page.getByRole("button", { name: "Show more" }).click();
  await expect(page.getByRole("button", { name: "Show less" })).toBeVisible();

  const chapterRows = page.locator("[data-chapter-no]");
  await expect(chapterRows.first()).toContainText("Chapter 1");

  await page.getByRole("button", { name: "Newest" }).click();
  await expect(chapterRows.first()).toContainText("Chapter 2");
});

test("series page can add a title to the library and the library page renders it", async ({ page }) => {
  let libraryEntry: Record<string, unknown> | null = null;
  const tags: Array<Record<string, unknown>> = [];

  await mockMedia(page);
  await page.route("**/api/series/series-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sourceId: "series-1",
        source: "weebcentral",
        title: "Series One",
        slug: "series-one",
        coverUrl: "/api/media/cover/series-1",
        description: "Quietly excellent series.",
        authors: ["Author One"],
        tags: ["Action"],
        type: "Manga",
        status: "Ongoing",
        year: 2024,
        isAdult: false,
        isOfficial: false,
        anilistUrl: null,
        relatedSeries: [],
      }),
    });
  });
  await page.route("**/api/series/series-1/chapters", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ sourceChapterId: "ch-1", chapterNo: 1, title: "Chapter 1" }]),
    });
  });
  await page.route("**/api/library/series-1", async (route) => {
    if (libraryEntry) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(libraryEntry),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "Library entry not found" }),
    });
  });
  await page.route("**/api/tags/series/series-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tagIds: [] }),
    });
  });
  await page.route("**/api/library", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      libraryEntry = {
        seriesId: body.seriesId,
        sourceSeriesId: body.seriesId,
        source: null,
        title: "Series One",
        coverUrl: "/api/media/cover/series-1",
        status: body.status,
        addedAt: "2026-03-04T00:00:00.000Z",
        updatedAt: "2026-03-04T00:00:00.000Z",
        currentPage: null,
        progressUpdatedAt: null,
        currentChapterSourceId: null,
        currentChapterTitle: null,
        totalChapters: 1,
        completedChapters: 0,
        unreadChapters: 1,
        downloadedChapters: 0,
        lastCompletedAt: null,
        lastCompletedChapterSourceId: null,
        lastCompletedChapterTitle: null,
        tagIds: [],
        adult: false,
      };

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(libraryEntry),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(libraryEntry ? [libraryEntry] : []),
    });
  });
  await page.route("**/api/tags", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(tags),
    });
  });

  await page.goto("/series/series-1");

  await page.getByRole("button", { name: "Add to library" }).click();
  await expect(page.getByRole("combobox", { name: "Library status" })).toBeVisible();

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
  await expect(page.getByText("Series One").first()).toBeVisible();
});

test("library page manages tags and series page assigns them", async ({ page }) => {
  let tags: Array<Record<string, unknown>> = [];
  let selectedTagIds: string[] = [];

  await mockMedia(page);
  await page.route("**/api/library", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
  await page.route("**/api/tags", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const nextTag = {
        id: "tag-1",
        name: body.name,
        color: body.color,
        type: body.type,
        seriesCount: 0,
      };
      tags = [nextTag];

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(nextTag),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(tags),
    });
  });
  await page.route("**/api/tags/tag-1", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      tags = [
        {
          ...tags[0],
          name: body.name,
          color: body.color,
          type: body.type,
        },
      ];

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(tags[0]),
      });
      return;
    }

    tags = [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route("**/api/anilist/status", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: false,
        connected: false,
        viewerName: null,
        expiresAt: null,
        lastSyncAt: null,
        linkedSeriesCount: 0,
        recentLogs: [],
      }),
    });
  });
  await page.route("**/api/offline", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ removedFiles: 0, removedBytes: 0 }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        storage: {
          cacheBytes: 0,
          cachedFiles: 0,
          pinnedBytes: 0,
          pinnedChapters: 0,
        },
        chapters: [],
      }),
    });
  });

  await page.goto("/manage");

  await page.getByPlaceholder("Tag name").fill("Cozy");
  await page.getByRole("combobox", { name: "Tag type" }).selectOption("mood");
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("Cozy")).toBeVisible();

  await page.route("**/api/series/series-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sourceId: "series-1",
        source: "weebcentral",
        title: "Series One",
        slug: "series-one",
        coverUrl: "/api/media/cover/series-1",
        description: "Quietly excellent series.",
        authors: ["Author One"],
        tags: ["Action"],
        type: "Manga",
        status: "Ongoing",
        year: 2024,
        isAdult: false,
        isOfficial: false,
        anilistUrl: null,
        relatedSeries: [],
      }),
    });
  });
  await page.route("**/api/series/series-1/chapters", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ sourceChapterId: "ch-1", chapterNo: 1, title: "Chapter 1" }]),
    });
  });
  await page.route("**/api/library/series-1", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "Library entry not found" }),
    });
  });
  await page.route("**/api/tags/series/series-1", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { tagIds: string[] };
      selectedTagIds = body.tagIds;

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ tagIds: selectedTagIds }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tagIds: selectedTagIds }),
    });
  });
  await page.route("**/api/offline?seriesId=series-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        storage: {
          cacheBytes: 0,
          cachedFiles: 0,
          pinnedBytes: 0,
          pinnedChapters: 0,
        },
        chapters: [],
      }),
    });
  });

  await page.goto("/series/series-1");

  await page.getByRole("checkbox", { name: "Cozy" }).check();
  await expect(page.getByRole("checkbox", { name: "Cozy" })).toBeChecked();
});

test("library page surfaces smart sections from stored reading signals", async ({ page }) => {
  await mockMedia(page);
  await page.route("**/api/tags", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
  await page.route("**/api/library", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          seriesId: "series-unread",
          sourceSeriesId: "series-unread",
          source: null,
          title: "Unread Shelf",
          coverUrl: "/api/media/cover/series-unread",
          status: "reading",
          addedAt: "2026-03-04T00:00:00.000Z",
          updatedAt: "2026-03-04T00:00:00.000Z",
          currentPage: 3,
          progressUpdatedAt: "2026-03-04T00:00:00.000Z",
          currentChapterSourceId: "ch-3",
          currentChapterTitle: "Chapter 3",
          totalChapters: 12,
          completedChapters: 3,
          unreadChapters: 9,
          downloadedChapters: 0,
          lastCompletedAt: null,
          lastCompletedChapterSourceId: null,
          lastCompletedChapterTitle: null,
          tagIds: ["tag-1"],
          adult: false,
        },
        {
          seriesId: "series-stalled",
          sourceSeriesId: "series-stalled",
          source: null,
          title: "Stalled Shelf",
          coverUrl: "/api/media/cover/series-stalled",
          status: "reading",
          addedAt: "2026-02-01T00:00:00.000Z",
          updatedAt: "2026-02-01T00:00:00.000Z",
          currentPage: 10,
          progressUpdatedAt: "2026-02-01T00:00:00.000Z",
          currentChapterSourceId: "ch-10",
          currentChapterTitle: "Chapter 10",
          totalChapters: 20,
          completedChapters: 10,
          unreadChapters: 10,
          downloadedChapters: 0,
          lastCompletedAt: "2026-02-01T00:00:00.000Z",
          lastCompletedChapterSourceId: "ch-10",
          lastCompletedChapterTitle: "Chapter 10",
          tagIds: ["tag-2"],
          adult: false,
        },
        {
          seriesId: "series-complete",
          sourceSeriesId: "series-complete",
          source: null,
          title: "Finished Shelf",
          coverUrl: "/api/media/cover/series-complete",
          status: "completed",
          addedAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-03T00:00:00.000Z",
          currentPage: 0,
          progressUpdatedAt: "2026-03-03T00:00:00.000Z",
          currentChapterSourceId: "ch-20",
          currentChapterTitle: "Chapter 20",
          totalChapters: 20,
          completedChapters: 20,
          unreadChapters: 0,
          downloadedChapters: 0,
          lastCompletedAt: "2026-03-03T00:00:00.000Z",
          lastCompletedChapterSourceId: "ch-20",
          lastCompletedChapterTitle: "Chapter 20",
          tagIds: ["tag-1"],
          adult: false,
        },
      ]),
    });
  });

  await page.goto("/");

  await expect(page.getByText("Pick up where you left off")).toBeVisible();
  await expect(page.getByRole("tab", { name: /Unread/i })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Stalled/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Unread Shelf" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Stalled Shelf" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Finished Shelf" }).first()).toBeVisible();
});

test("library page filters and sorts entries", async ({ page }) => {
  await mockMedia(page);
  await page.route("**/api/tags", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "tag-1",
          name: "Cozy",
          color: "#d97706",
          type: "mood",
          seriesCount: 1,
        },
      ]),
    });
  });
  await page.route("**/api/library", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          seriesId: "series-1",
          sourceSeriesId: "series-1",
          source: null,
          title: "Alpha Series",
          coverUrl: "/api/media/cover/series-1",
          status: "reading",
          addedAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-04T00:00:00.000Z",
          currentPage: 2,
          progressUpdatedAt: "2026-03-04T00:00:00.000Z",
          currentChapterSourceId: "ch-2",
          currentChapterTitle: "Chapter 2",
          totalChapters: 10,
          completedChapters: 2,
          unreadChapters: 8,
          downloadedChapters: 0,
          lastCompletedAt: null,
          lastCompletedChapterSourceId: null,
          lastCompletedChapterTitle: null,
          tagIds: ["tag-1"],
          adult: false,
        },
        {
          seriesId: "series-2",
          sourceSeriesId: "series-2",
          source: null,
          title: "Beta Series",
          coverUrl: "/api/media/cover/series-2",
          status: "completed",
          addedAt: "2026-03-01T00:00:00.000Z",
          updatedAt: "2026-03-03T00:00:00.000Z",
          currentPage: 0,
          progressUpdatedAt: "2026-03-03T00:00:00.000Z",
          currentChapterSourceId: "ch-10",
          currentChapterTitle: "Chapter 10",
          totalChapters: 10,
          completedChapters: 10,
          unreadChapters: 0,
          downloadedChapters: 0,
          lastCompletedAt: "2026-03-03T00:00:00.000Z",
          lastCompletedChapterSourceId: "ch-10",
          lastCompletedChapterTitle: "Chapter 10",
          tagIds: [],
          adult: false,
        },
      ]),
    });
  });

  await page.goto("/");

  await page.getByPlaceholder("Search in library…").fill("Alpha");
  await expect(page.getByText("Alpha Series").first()).toBeVisible();

  await page.getByPlaceholder("Search in library…").fill("NoMatch");
  await expect(page.getByText("No library series match this search.")).toBeVisible();

  await page.getByPlaceholder("Search in library…").fill("");
  await page.getByRole("button", { name: "Filter" }).click();
  await page.locator("select").nth(1).selectOption("completed");
  await expect(page.getByText("Beta Series").first()).toBeVisible();

  await page.locator("select").nth(1).selectOption("");
  await page.getByRole("tab", { name: "Reading" }).click();
  await expect(page.getByText("Alpha Series").first()).toBeVisible();

  await page.getByRole("tab", { name: /^All/ }).click();
  await page.locator("select").nth(2).selectOption("tag-1");
  await expect(page.getByText("Alpha Series").first()).toBeVisible();

  await page.locator("select").nth(2).selectOption("");
  await page.locator("select").first().selectOption("added-asc");
  const filteredLinks = page.locator('main a[href^="/series/"]');
  await expect(filteredLinks.first()).toContainText("Beta Series");
});

test("reader page restores progress, persists preference changes, and saves progress", async ({ page }) => {
  const patchBodies: Array<Record<string, unknown>> = [];
  const postBodies: Array<Record<string, unknown>> = [];

  await mockMedia(page);
  await page.route("**/api/chapters/ch-*/pages?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          index: 0,
          imageUrl: "/api/media/page?url=https%3A%2F%2Fhot.planeptune.us%2Fpage-1.jpg",
        },
        {
          index: 1,
          imageUrl: "/api/media/page?url=https%3A%2F%2Fhot.planeptune.us%2Fpage-2.jpg",
        },
        {
          index: 2,
          imageUrl: "/api/media/page?url=https%3A%2F%2Fhot.planeptune.us%2Fpage-3.jpg",
        },
      ]),
    });
  });
  await page.route("**/api/series/series-1/chapters", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { sourceChapterId: "ch-1", chapterNo: 1, title: "Chapter 1" },
        { sourceChapterId: "ch-2", chapterNo: 2, title: "Chapter 2" },
      ]),
    });
  });
  await page.route("**/api/series/series-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ title: "Test Series", coverUrl: null }),
    });
  });
  await page.route("**/api/reader/state?seriesId=series-1&chapterId=*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        preferences: {
          readingDirection: "vertical",
          fitMode: "width",
        },
        progress: {
          currentPage: 1,
          completed: false,
          updatedAt: null,
        },
      }),
    });
  });
  await page.route("**/api/reader/state", async (route) => {
    if (route.request().method() === "PATCH") {
      patchBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    }
    if (route.request().method() === "POST") {
      postBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto("/read/series-1/ch-1");
  await expect(page.getByAltText("Page 2")).toBeVisible();

  await page.keyboard.press("m");
  await expect.poll(() => patchBodies.length).toBeGreaterThan(0);
  expect(patchBodies.at(-1)?.readingDirection).toBe("ltr");
  await expect(page.getByRole("button", { name: "Next page" })).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(page.getByAltText("Page 3")).toBeVisible();

  await page.waitForTimeout(900);
  expect(postBodies.some((body) => body.currentPage === 2)).toBe(true);

  await page.keyboard.press("]");
  await expect(page).toHaveURL(/\/read\/~[^/]+\/~Y2gtMg$/);
});
