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

  await expect(page.getByRole("heading", { name: "Reader" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Search" })).toHaveAttribute(
    "href",
    "/search",
  );
  await expect(page.getByRole("main").getByRole("link", { name: "Library" })).toHaveAttribute(
    "href",
    "/library",
  );
});

test("search page submits a query and renders results", async ({ page }) => {
  await mockMedia(page);
  await page.route("**/api/search?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          sourceId: "series-1",
          title: "Monster",
          slug: "monster",
          coverUrl: "cover.jpg",
          year: 1994,
          status: "Complete",
          type: "Manga",
          authors: ["Naoki Urasawa"],
          tags: ["Psychological"],
        },
      ]),
    });
  });

  await page.goto("/search");
  await expect(page.getByText("Search for a manga, manhwa, or comic to get started.")).toBeVisible();

  await page.getByRole("textbox").fill("Monster");
  await page.getByRole("textbox").press("Enter");

  await expect(page).toHaveURL(/\/search\?q=Monster$/);
  await expect(page.getByRole("link", { name: /Monster/i })).toBeVisible();
  await expect(page.getByText("Naoki Urasawa")).toBeVisible();
  await expect(page.getByText("Complete")).toBeVisible();
});

test("series page renders metadata and lets the reader reorder chapters", async ({ page }) => {
  await mockMedia(page);
  await page.route("**/api/series/series-1", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sourceId: "series-1",
        title: "Series One",
        slug: "series-one",
        coverUrl: "cover.jpg",
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

  const chapterLinks = page.locator('a[href^="/read/series-1/"]');
  await expect(chapterLinks.nth(0)).toContainText("Chapter 1");

  await page.getByRole("button", { name: /Newest first/i }).click();
  await expect(chapterLinks.nth(0)).toContainText("Chapter 2");
});

test("reader page restores progress, persists preference changes, and saves progress", async ({ page }) => {
  const patchBodies: Array<Record<string, unknown>> = [];
  const postBodies: Array<Record<string, unknown>> = [];

  await mockMedia(page);
  await page.route("**/api/chapters/ch-*/pages", async (route) => {
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

  await expect(page.getByText("Page 2 / 3")).toBeVisible();

  await page.keyboard.press("m");
  await expect.poll(() => patchBodies.length).toBeGreaterThan(0);
  expect(patchBodies.at(-1)?.readingDirection).toBe("ltr");

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Page 3 / 3")).toBeVisible();

  await page.waitForTimeout(900);
  expect(postBodies.some((body) => body.currentPage === 2)).toBe(true);

  await page.keyboard.press("]");
  await expect(page).toHaveURL(/\/read\/series-1\/ch-2$/);
});
